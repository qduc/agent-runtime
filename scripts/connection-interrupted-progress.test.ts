import { describe, expect, it } from 'vitest';
import { startTurn } from '../packages/core/src/engine/turn.js';
import { TurnEvents } from '../packages/core/src/engine/turn-events.js';
import type { ToolRegistry as EngineToolRegistry, TurnEvent, TurnId } from '../packages/core/src/engine/index.js';
import { ModelFailure } from '../packages/core/src/model/index.js';
import type {
  Item,
  Model,
  ModelEvent,
  ModelRequest,
  ModelRef,
  ModelRegistry,
  ToolCallId,
  ToolSpec,
} from '../packages/core/src/model/index.js';
import type { Tool } from '../packages/core/src/tools/contracts.js';

const modelRef: ModelRef = { provider: 'fixture', model: 'partial-tool-recovery' };
const connectionDrop = () =>
  new ModelFailure(
    { kind: 'network', message: 'WebSocket closed before terminal response', retryable: true },
    undefined,
    'connection_interrupted',
  );

function createModel(
  stream: (attempt: number, request: ModelRequest) => AsyncIterable<ModelEvent>,
): { model: Model; calls: () => number } {
  let calls = 0;
  const model: Model = {
    ref: modelRef,
    contextWindow: 32_000,
    stream: async function* (request, _signal) {
      calls += 1;
      yield* stream(calls, request);
    },
  };
  return { model, calls: () => calls };
}

async function run(
  model: Model,
  options: { readonly toolSpecs?: readonly ToolSpec[]; readonly tools?: EngineToolRegistry } = {},
): Promise<TurnEvent[]> {
  const models: ModelRegistry = { resolve: () => model, list: () => [modelRef] };
  const user: Item = {
    type: 'user_message',
    id: 'user-1' as Item['id'],
    content: [{ type: 'text', text: 'Run the requested tool.' }],
  };
  const handle = startTurn(
    {
      turnId: 'turn-1' as TurnId,
      history: [],
      newItems: [user],
      instructions: 'Be helpful.',
      model: modelRef,
      tools: options.toolSpecs ?? [],
    },
    {
      models,
      ...(options.tools ? { tools: options.tools, toolContext: {} } : {}),
      recovery: { maxTransientRetries: 1, random: () => 0 },
    },
  );
  const events: TurnEvent[] = [];
  for await (const accepted of handle.events) {
    events.push(accepted.event);
    handle.accept(accepted.token);
  }
  return events;
}

describe('connection-interrupted recovery after progress', () => {
  it('delivers progress cleanup when it arrives after cancellation', async () => {
    const events = new TurnEvents();
    events.cancel();

    await events.publish({
      type: 'tool_call_progress_cleared',
      turnId: 'turn-1' as TurnId,
      modelStep: 1,
    });

    await expect(events.events().next()).resolves.toMatchObject({
      value: { event: { type: 'tool_call_progress_cleared', modelStep: 1 } },
      done: false,
    });
  });

  it('retries after only streamed tool-argument progress and usage, without executing a tool', async () => {
    const { model, calls } = createModel(async function* (attempt) {
      if (attempt === 1) {
        yield {
          type: 'tool_call_streaming_delta',
          argumentCharCount: 24,
          toolName: 'shell',
          callId: 'call-partial' as ToolCallId,
          itemId: 'item-partial',
          callIndex: 0,
        };
        yield {
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 8, cachedInputTokens: 0 },
        };
        throw connectionDrop();
      }
      yield { type: 'text_delta', delta: 'recovered' };
      yield { type: 'done', stopReason: 'end_turn' };
    });

    const events = await run(model);
    const terminal = events.find((event) => event.type === 'turn_ended');
    const progressIndex = events.findIndex((event) => event.type === 'tool_call_streaming_delta');
    const clearedIndex = events.findIndex((event) => event.type === 'tool_call_progress_cleared');
    const recoveredTextIndex = events.findIndex((event) => event.type === 'text_delta' && event.delta === 'recovered');

    expect(calls()).toBe(2);
    expect(progressIndex).toBeGreaterThanOrEqual(0);
    expect(clearedIndex).toBeGreaterThan(progressIndex);
    expect(events[clearedIndex]).toMatchObject({ type: 'tool_call_progress_cleared', modelStep: 1 });
    expect(recoveredTextIndex).toBeGreaterThan(clearedIndex);
    expect(terminal?.type === 'turn_ended' && terminal.result.kind).toBe('completed');
    expect(events.some((event) => event.type === 'tool_start_requested')).toBe(false);
  });

  it('does not retry after a complete tool-call item has been accepted', async () => {
    const { model, calls } = createModel(async function* () {
      yield {
        type: 'item',
        item: {
          type: 'tool_call',
          id: 'tool-item' as Item['id'],
          callId: 'tool-call' as ToolCallId,
          toolName: 'shell',
          input: { command: 'fixture' },
          rawArguments: '{"command":"fixture"}',
        },
      };
      throw connectionDrop();
    });

    const events = await run(model);
    const terminal = events.find((event) => event.type === 'turn_ended');

    expect(calls()).toBe(1);
    expect(events.some((event) => event.type === 'tool_called')).toBe(true);
    expect(events.some((event) => event.type === 'tool_start_requested')).toBe(false);
    expect(terminal?.type === 'turn_ended' && terminal.result.kind).toBe('failed');
  });

  it.each(['text', 'reasoning'] as const)(
    'does not retry when %s output precedes partial tool-argument progress',
    async (outputKind) => {
      const { model, calls } = createModel(async function* () {
        if (outputKind === 'text') yield { type: 'text_delta', delta: 'visible partial answer' };
        else yield { type: 'reasoning_delta', delta: 'visible reasoning' };
        yield {
          type: 'tool_call_streaming_delta',
          argumentCharCount: 24,
          toolName: 'shell',
          callId: 'call-partial' as ToolCallId,
          itemId: 'item-partial',
          callIndex: 0,
        };
        throw connectionDrop();
      });

      const events = await run(model);
      const terminal = events.find((event) => event.type === 'turn_ended');

      expect(calls()).toBe(1);
      expect(terminal?.type === 'turn_ended' && terminal.result.kind).toBe('failed');
    },
  );

  it('preserves a settled tool result pair while retrying a later progress-only request', async () => {
    let toolExecutions = 0;
    const requests: ModelRequest[] = [];
    const tool: Tool = {
      spec: {
        name: 'effect',
        description: 'Fixture side effect',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      parse: (input) => input,
      approval: () => ({ kind: 'none' }),
      execute: async () => {
        toolExecutions += 1;
        return { output: 'settled once', isError: false };
      },
    };
    const toolSpecs = [tool.spec];
    const tools: EngineToolRegistry = { get: (name) => (name === 'effect' ? tool : undefined), available: () => [tool] };
    const { model, calls } = createModel(async function* (attempt, request) {
      requests.push(request);
      if (attempt === 1) {
        yield {
          type: 'item',
          item: {
            type: 'tool_call',
            id: 'tool-item' as Item['id'],
            callId: 'tool-call' as ToolCallId,
            toolName: 'effect',
            input: {},
            rawArguments: '{}',
          },
        };
        yield { type: 'done', stopReason: 'tool_use' };
      } else if (attempt === 2) {
        yield {
          type: 'tool_call_streaming_delta',
          argumentCharCount: 24,
          toolName: 'effect',
          callId: 'call-retry' as ToolCallId,
          itemId: 'item-retry',
          callIndex: 0,
        };
        throw connectionDrop();
      } else {
        yield { type: 'text_delta', delta: 'recovered after tool result' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    });

    const events = await run(model, { toolSpecs, tools });
    const terminal = events.find((event) => event.type === 'turn_ended');

    expect(calls()).toBe(3);
    expect(toolExecutions).toBe(1);
    expect(events.filter((event) => event.type === 'tool_execution_finished')).toHaveLength(1);
    expect(requests[2]?.input.some((item) => item.type === 'tool_call' && item.callId === ('tool-call' as ToolCallId))).toBe(true);
    expect(requests[2]?.input.some((item) => item.type === 'tool_result' && item.callId === ('tool-call' as ToolCallId))).toBe(true);
    expect(terminal?.type === 'turn_ended' && terminal.result.kind).toBe('completed');
  });

  it('stops after the bounded silent and session-level connection retries', async () => {
    const { model, calls } = createModel(async function* () {
      yield {
        type: 'tool_call_streaming_delta',
        argumentCharCount: 24,
        toolName: 'shell',
        callId: 'call-partial' as ToolCallId,
        itemId: 'item-partial',
        callIndex: 0,
      };
      throw connectionDrop();
    });

    const events = await run(model);
    const terminal = events.find((event) => event.type === 'turn_ended');

    // One silent retry is allowed before and after the single session-level retry.
    expect(calls()).toBe(4);
    expect(terminal?.type === 'turn_ended' && terminal.result.kind).toBe('failed');
  });
});
