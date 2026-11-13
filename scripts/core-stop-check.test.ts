import { describe, expect, it } from 'vitest';
import { startTurn } from '../packages/core/src/index.ts';
import type { Item, ItemId, ModelRequest, ToolCallId } from '../packages/core/src/model/index.ts';
import type { NormalStopDecision, TurnDeps, TurnResult, TurnSpec } from '../packages/core/src/engine/types.ts';
import type { Tool } from '../packages/core/src/tools/contracts.ts';

// Black-box checks of the opt-in stop-check seam through the public `startTurn` entry point.
type Step = { readonly text?: string; readonly calls?: readonly string[] };
type StopContext = Parameters<NonNullable<TurnDeps['normalStop']>>[0];

function tool(name: string, output: (input: unknown) => { output: string; isError: boolean }): Tool {
  return {
    spec: { name, description: name, inputSchema: { type: 'object' } },
    parse: (raw: unknown) => raw,
    approval: () => ({ kind: 'none' }),
    execute: async (input: unknown) => output(input),
  } as Tool;
}

async function run(options: {
  readonly steps: readonly Step[];
  readonly stop: (context: StopContext, call: number) => NormalStopDecision;
  readonly stopCheckTools?: readonly string[];
  readonly checkFails?: boolean;
  readonly steering?: (requestsSoFar: number) => readonly Item[];
}) {
  const requests: ModelRequest[] = [];
  const stops: StopContext[] = [];
  const items: Item[] = [];
  const tools = [
    tool('check', () => ({ output: options.checkFails ? 'not recorded' : 'recorded', isError: !!options.checkFails })),
    tool('work', () => ({ output: 'worked', isError: false })),
  ];
  const model = {
    ref: { provider: 'fake', model: 'fake' },
    contextWindow: 128000,
    async *stream(request: ModelRequest) {
      requests.push(request);
      const step = options.steps[requests.length - 1] ?? { text: 'fallback' };
      if (step.text !== undefined)
        yield {
          type: 'item' as const,
          item: {
            type: 'assistant_message' as const,
            id: `a${requests.length}` as ItemId,
            content: [{ type: 'text' as const, text: step.text }],
          },
        };
      for (const [index, name] of (step.calls ?? []).entries())
        yield {
          type: 'item' as const,
          item: {
            type: 'tool_call' as const,
            id: `c${requests.length}-${index}` as ItemId,
            callId: `call${requests.length}-${index}` as ToolCallId,
            toolName: name,
            input: {},
          },
        };
      yield { type: 'done' as const, stopReason: step.calls?.length ? ('tool_use' as const) : ('end_turn' as const) };
    },
  };
  const spec: TurnSpec = {
    turnId: 't' as TurnSpec['turnId'],
    history: [],
    newItems: [{ type: 'user_message', id: 'u' as ItemId, content: [{ type: 'text', text: 'go' }] }],
    instructions: '',
    model: model.ref,
    tools: tools.map((entry) => entry.spec),
  };
  const handle = startTurn(spec, {
    models: { resolve: () => model, list: () => [] } as unknown as TurnDeps['models'],
    tools: { get: (name) => tools.find((entry) => entry.spec.name === name), available: () => tools },
    toolContext: {},
    ...(options.stopCheckTools ? { stopCheckTools: options.stopCheckTools } : {}),
    ...(options.steering ? { takeSteering: () => options.steering!(requests.length) } : {}),
    normalStop: async (context) => {
      stops.push(context);
      return options.stop(context, stops.length);
    },
  });
  let result: TurnResult | undefined;
  for await (const { event, token } of handle.events) {
    if (event.type === 'item') items.push(event.item);
    if (event.type === 'turn_ended') result = event.result;
    handle.accept(token);
  }
  return { requests, stops, items, result };
}

const accept = (): NormalStopDecision => ({ action: 'stop' });

describe('stop-check tools', () => {
  it('ends on the response carrying final text and an accepted lone check', async () => {
    const out = await run({ steps: [{ text: 'Done.', calls: ['check'] }], stop: accept, stopCheckTools: ['check'] });
    expect(out.requests).toHaveLength(1);
    expect(out.result).toEqual({ kind: 'completed' });
    expect(out.stops).toHaveLength(1);
    expect(out.stops[0]!.stopCheck).toEqual({ toolName: 'check', callId: 'call1-0', modelStep: 1 });
    expect(out.items.at(-1)).toMatchObject({ type: 'tool_result', output: 'recorded' });
  });

  it('keeps the receipt-first default for a host that does not opt in', async () => {
    const out = await run({ steps: [{ text: 'Done.', calls: ['check'] }, { text: 'Final.' }], stop: accept });
    expect(out.requests).toHaveLength(2);
    expect(out.stops.map((stop) => stop.stopCheck)).toEqual([undefined]);
  });

  it('falls back when the response has no text besides the call', async () => {
    for (const text of [undefined, '', '  \n']) {
      const out = await run({
        steps: [{ ...(text !== undefined ? { text } : {}), calls: ['check'] }, { text: 'Final.' }],
        stop: accept,
        stopCheckTools: ['check'],
      });
      expect(out.requests).toHaveLength(2);
      expect(out.stops.map((stop) => stop.stopCheck)).toEqual([undefined]);
    }
  });

  it('does not treat a check alongside another call as terminal', async () => {
    const out = await run({
      steps: [{ text: 'Done.', calls: ['work', 'check'] }, { text: 'Final.' }],
      stop: accept,
      stopCheckTools: ['check'],
    });
    expect(out.requests).toHaveLength(2);
    expect(out.stops.map((stop) => stop.stopCheck)).toEqual([undefined]);
  });

  it('does not consult on an error result', async () => {
    const out = await run({
      steps: [{ text: 'Done.', calls: ['check'] }, { text: 'Final.' }],
      stop: accept,
      stopCheckTools: ['check'],
      checkFails: true,
    });
    expect(out.requests).toHaveLength(2);
    expect(out.stops.map((stop) => stop.stopCheck)).toEqual([undefined]);
  });

  it('continues exactly as the default after a deferral', async () => {
    const out = await run({
      steps: [{ text: 'Done.', calls: ['check'] }, { text: 'Final.' }],
      stop: (context) => (context.stopCheck ? { action: 'defer' } : { action: 'stop' }),
      stopCheckTools: ['check'],
    });
    expect(out.requests).toHaveLength(2);
    expect(out.requests[1]!.input.at(-1)).toMatchObject({ type: 'tool_result', output: 'recorded' });
    expect(out.stops.map((stop) => stop.stopCheck?.toolName)).toEqual(['check', undefined]);
    expect(out.items.some((item) => item.type === 'summary')).toBe(false);
  });

  it('adds the reminder after the receipt when the policy continues', async () => {
    const out = await run({
      steps: [{ text: 'Done.', calls: ['check'] }, { text: 'Final.' }],
      stop: (context) => (context.stopCheck ? { action: 'continue', reminder: 'Repair.' } : { action: 'stop' }),
      stopCheckTools: ['check'],
    });
    expect(out.requests).toHaveLength(2);
    expect(out.requests[1]!.input.slice(-2)).toMatchObject([
      { type: 'tool_result', output: 'recorded' },
      { type: 'summary', text: '[Mode Notice] Repair.' },
    ]);
  });

  it('maps a stop with a terminal cause like a normal stop', async () => {
    const out = await run({
      steps: [{ text: 'Done.', calls: ['check'] }],
      stop: () => ({ action: 'stop', terminalCause: 'completion_verification_blocked', notice: 'blocked' }),
      stopCheckTools: ['check'],
    });
    expect(out.requests).toHaveLength(1);
    expect(out.result).toEqual({
      kind: 'interrupted',
      terminalCause: 'completion_verification_blocked',
      notice: 'blocked',
    });
  });

  it('lets waiting steering reach the model before any stop', async () => {
    let steered = false;
    const steer: Item = { type: 'user_message', id: 's' as ItemId, content: [{ type: 'text', text: 'also' }] };
    const out = await run({
      steps: [{ text: 'Done.', calls: ['check'] }, { text: 'Final.' }],
      stop: accept,
      stopCheckTools: ['check'],
      // Steering arrives while the first response's check runs.
      steering: (requestsSoFar) => (steered || requestsSoFar === 0 ? [] : ((steered = true), [steer])),
    });
    expect(out.requests).toHaveLength(2);
    expect(out.requests[1]!.input.at(-1)).toEqual(steer);
    expect(out.stops.map((stop) => stop.stopCheck)).toEqual([undefined]);
  });

  it('rejects a deferral at an ordinary normal stop', async () => {
    const out = await run({ steps: [{ text: 'Final.' }], stop: () => ({ action: 'defer' }), stopCheckTools: ['check'] });
    expect(out.result).toMatchObject({ kind: 'failed' });
  });
});
