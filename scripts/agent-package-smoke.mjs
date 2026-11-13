import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'agent-package-smoke-'));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', NODE_PATH: '' },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const tarballs = [];
  for (const name of ['wire', 'core']) {
    const directory = join(root, 'packages', name);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, `@qduc/agent-${name}`);
    assert.notEqual(manifest.version, '0.0.0', `${manifest.name} needs a release version`);
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.publishConfig.access, 'public');
    assert.equal(manifest.repository.url, 'https://github.com/qduc/agent-runtime.git');
    run('pnpm', ['--filter', manifest.name, 'build']);
    const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], directory))[0];
    const paths = new Set(packed.files.map((file) => file.path));
    for (const path of ['README.md', 'LICENSE', manifest.exports['.'].types, manifest.exports['.'].default]) {
      assert.ok(paths.has(path.replace(/^\.\//, '')), `${manifest.name} tarball is missing ${path}`);
    }
    tarballs.push(join(temporary, packed.filename));
    console.log(`${manifest.name}@${manifest.version}: packed ${packed.files.length} files (${packed.size} bytes)`);
  }

  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...tarballs, '@types/node@24'],
    temporary,
  );
  await writeFile(
    join(temporary, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
import { AGENT_EVENT_TYPES, parseAgentEventEnvelope, parseAgentEventEnvelopeV2, AgentWireError } from '@qduc/agent-wire';
assert.ok(AGENT_EVENT_TYPES.includes('turn_completed'));
const event = { schemaVersion: 1, id: 1, sessionId: 'session-1', type: 'turn_completed', occurredAt: '2026-10-03T00:00:00Z', payload: {} };
assert.deepEqual(parseAgentEventEnvelope(event, 'session-1'), event);
assert.throws(() => parseAgentEventEnvelope(event, 'another-session'), AgentWireError);
const question = { messageId: 'question:1', question: 'Which approach?' };
const tracking = { lastObservation: { kind: 'question_asked', at: 1 }, lastToolName: 'ask_orchestrator', lastTool: { label: 'ask_orchestrator question', state: 'running' }, toolCounts: [{ toolName: 'ask_orchestrator', count: 1 }] };
const task = { id: 'child', status: 'awaiting_interaction', pendingQuestion: question, ...tracking };
const envelope = (change, descriptor = task) => ({ schemaVersion: 2, kind: 'accepted', sessionId: 'session-1', seq: 2, occurredAt: event.occurredAt, changes: [{ type: 'task_changed', payload: { change, at: 1, task: descriptor } }] });
for (const change of ['task_started', 'task_question_opened', 'task_question_closed']) {
  const input = envelope(change, change === 'task_question_closed' ? { id: 'child', status: 'running', ...tracking } : task);
  assert.deepEqual(parseAgentEventEnvelopeV2(input), input);
}
for (const pendingQuestion of [null, {}, { question: 'text' }, { ...question, messageId: '' }, { ...question, question: ' ' }, { ...question, question: 1 }, { ...question, answer: 'not a public snapshot field' }]) {
  assert.throws(() => parseAgentEventEnvelopeV2(envelope('task_question_opened', { ...task, pendingQuestion })), AgentWireError);
}
for (const malformed of [
  { lastTool: { label: 'x', state: 'complete' } },
  { lastTool: { label: 'x', state: 'running', private: true } },
  { lastToolName: '' },
  { lastObservation: { kind: 'unknown', at: 1 } },
  { lastObservation: { kind: 'tool_started', at: 1 } },
  { lastObservation: { kind: 'retrying', at: 1, attempt: -1, maxRetries: 2 } },
  { lastObservation: { kind: 'question_asked', at: 1, private: true } },
  { toolCounts: [{ toolName: 'ask_orchestrator', count: 0 }] },
  { toolCounts: [{ toolName: 'ask_orchestrator', count: 1.5 }] },
  { toolCounts: [{ toolName: 'ask_orchestrator', count: 1 }, { toolName: 'ask_orchestrator', count: 2 }] },
]) assert.throws(() => parseAgentEventEnvelopeV2(envelope('task_question_opened', { ...task, ...malformed })), AgentWireError);
for (const lastObservation of [
  ...['request_dispatched', 'response_started', 'text_received', 'approval_requested', 'question_asked', 'shell_started', 'shell_output_received', 'stop_requested', 'settled'].map(kind => ({ kind, at: 1 })),
  { kind: 'tool_input_received', at: 1, toolName: 'ask_orchestrator', argumentCharCount: 20 },
  { kind: 'tool_started', at: 1, toolName: 'ask_orchestrator' },
  { kind: 'tool_completed', at: 1 },
  { kind: 'tool_completed', at: 1, toolName: 'ask_orchestrator' },
  { kind: 'retrying', at: 1, attempt: 1, maxRetries: 2 },
]) assert.doesNotThrow(() => parseAgentEventEnvelopeV2(envelope('task_question_opened', { ...task, lastObservation })));
assert.throws(() => parseAgentEventEnvelopeV2(envelope('unknown_task_change')), AgentWireError);
console.log('Installed tarballs: runtime imports and v2 task questions passed');
`,
  );
  await writeFile(
    join(temporary, 'consumer.ts'),
    `
import { parseAgentEventEnvelope, type AgentEventEnvelope } from '@qduc/agent-wire';
const event: AgentEventEnvelope = parseAgentEventEnvelope({});
void event;
import { startTurn, type TurnSpec, type Usage } from '@qduc/agent-core';
const spec: TurnSpec = { turnId: 't' as TurnSpec['turnId'], history: [], newItems: [], instructions: '', model: { provider: 'p', model: 'm' }, tools: [] };
const usage: Usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 1 };
void startTurn;
void spec;
void usage;
`,
  );
  console.log(run(process.execPath, ['consumer.mjs'], temporary).trim());
  await writeFile(join(temporary, 'core-consumer.mjs'), String.raw`
import assert from 'node:assert/strict';
import { startTurn } from '@qduc/agent-core';

let entered = 0;
let release;
const overlapping = new Promise((resolve) => { release = resolve; });
const observations = [];
async function runTurn(userId, temperature) {
  const app = { userId, settings: { temperature } };
  let calls = 0;
  const tool = {
    spec: { name: 'whoami', description: 'Return the current user', inputSchema: { type: 'object' } },
    parse: (raw) => raw,
    approval: () => ({ kind: 'none' }),
    async execute(input, ctx) {
      assert.equal(input.userId, userId);
      assert.equal(ctx.app, app);
      assert.equal(ctx.app.settings.temperature, temperature);
      ctx.progress(userId);
      observations.push(ctx.app.userId);
      return { output: ctx.app.userId, isError: false };
    },
  };
  const model = {
    ref: { provider: 'fake', model: 'fake' },
    contextWindow: 128000,
    async *stream(request, signal, onDispatched) {
      assert.equal(request.temperature, temperature);
      assert.deepEqual(request.affinity, { conversationKey: userId, cacheKey: userId + '-cache', routingKey: userId + '-route' });
      assert.equal(request.providerOptions.userId, userId);
      assert.equal(signal.aborted, false);
      onDispatched?.();
      if (calls++ === 0) {
        if (++entered === 2) release();
        await overlapping;
        yield { type: 'item', item: {
          type: 'tool_call', id: userId + '-call', callId: userId + '-call',
          toolName: 'whoami', input: { userId },
        } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        const result = request.input.find((item) => item.type === 'tool_result');
        assert.equal(result.output, userId);
        yield { type: 'item', item: {
          type: 'assistant_message', id: userId + '-answer', content: [{ type: 'text', text: userId }],
        } };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  };
  const handle = startTurn({
    turnId: userId, history: [], newItems: [], instructions: 'Identify the user',
    affinity: { conversationKey: userId, cacheKey: userId + '-cache', routingKey: userId + '-route' },
    model: { provider: 'fake', model: 'fake' }, tools: [tool.spec],
    temperature, limits: { maxModelCalls: 2, maxToolCalls: 1 },
  }, {
    models: { resolve: () => model, list: () => [] },
    tools: { get: (name) => name === 'whoami' ? tool : undefined, available: () => [tool] },
    toolContext: app,
    prepareRequest: (request) => ({ request: { ...request, providerOptions: { userId } } }),
  });
  let outcome;
  for await (const { event, token } of handle.events) {
    if (event.type === 'turn_ended') outcome = event.result;
    handle.accept(token);
  }
  assert.equal(outcome.kind, 'completed');
  assert.equal(calls, 2);
}
await Promise.all([runTurn('alice', 0.1), runTurn('bob', 0.9)]);
assert.deepEqual(observations.sort(), ['alice', 'bob']);
console.log('Installed tarballs: two concurrent core turns completed in isolation');
`);
  console.log(run(process.execPath, ['core-consumer.mjs'], temporary).trim());
  await writeFile(join(temporary, 'core-usage.mjs'), String.raw`
import assert from 'node:assert/strict';
import { startTurn, startCompaction, RunBudget } from '@qduc/agent-core';

const policy = {
  maxUsdMicros: 1e12, maxUnpricedTokens: 1e12, maxActiveTimeMs: 1e12,
  warningHeadroomUsdMicros: 0, warningHeadroomUnpricedTokens: 0, warningHeadroomActiveTimeMs: 0,
  softHeadroomUsdMicros: 0, softHeadroomUnpricedTokens: 0, softHeadroomActiveTimeMs: 0,
  turnBackstop: 1000, extensionPercent: 0, maxParentExtensions: 0, identicalToolCallThreshold: 1000,
  escalation: 'contain',
};
// Reasoning is a subset of output: the second request is identical except that it reports none.
const reported = [
  { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0, reasoningTokens: 150 },
  { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0 },
];
async function observe(start, getPrice, history = []) {
  let calls = 0;
  const model = {
    ref: { provider: 'fake', model: 'fake' },
    contextWindow: 128000,
    async *stream(request, signal, onDispatched) {
      onDispatched?.();
      const usage = reported[calls++];
      yield { type: 'item', item: { type: 'assistant_message', id: 'answer-' + calls, content: [{ type: 'text', text: 'brief' }] } };
      yield { type: 'usage', usage };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  const handle = start({ turnId: 't', history, newItems: [], instructions: '', model: model.ref, tools: [] }, {
    models: { resolve: () => model, list: () => [] },
    tools: { get: () => undefined, available: () => [] },
    toolContext: {},
    accounting: { getPrice },
    budget: { policy },
    normalStop: () => ({ action: calls < 2 ? 'continue' : 'stop', reminder: 'continue' }),
    compaction: {
      settings: { enabled: true, mode: 'local', compactThreshold: 0.8, compactThresholdTokens: null },
      contextWindow: 128000,
    },
  });
  const costs = [];
  const compactionRequests = [];
  for await (const { event, token } of handle.events) {
    if (event.type === 'request_cost') costs.push(event.record);
    if (event.type === 'compaction_completed' || event.type === 'compaction_failed')
      compactionRequests.push(...event.requests);
    handle.accept(token);
  }
  return { costs, compactionRequests };
}

const priced = await observe(startTurn, () => ({ found: true, price: { inputPerMTok: 1, outputPerMTok: 10 } }));
assert.deepEqual(priced.costs.map((cost) => cost.usage), [
  { prompt_tokens: 1000, completion_tokens: 200, cache_read_tokens: 0, reasoning_tokens: 150, total_tokens: 1200 },
  { prompt_tokens: 1000, completion_tokens: 200, cache_read_tokens: 0, total_tokens: 1200 },
]);
// Reasoning is never billed a second time.
assert.deepEqual(priced.costs.map((cost) => cost.usdMicros), [3000, 3000]);

const unpriced = await observe(startTurn, () => ({ found: false, reason: 'unknown_model' }));
const budget = new RunBudget(policy);
budget.evaluate({ turns: 2, costRecords: unpriced.costs });
assert.equal(budget.snapshot().unpricedTokens, 2400, 'reasoning must not add to unpriced-token consumption');

const history = [];
for (let index = 0; index < 4; index++)
  history.push(
    { type: 'user_message', id: 'u' + index, content: [{ type: 'text', text: 'question ' + index }] },
    { type: 'assistant_message', id: 'a' + index, content: [{ type: 'text', text: 'answer ' + index }] },
  );
const compaction = await observe(startCompaction, () => ({ found: false, reason: 'unknown_model' }), history);
assert.equal(compaction.compactionRequests.length, 1);
assert.deepEqual(compaction.compactionRequests[0].usage, reported[0]);
assert.equal(compaction.costs[0].usage.reasoning_tokens, 150);
console.log('Installed tarballs: reasoning tokens reach request and compaction cost records without changing totals');
`);
  console.log(run(process.execPath, ['core-usage.mjs'], temporary).trim());
  run(
    join(root, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--types',
      'node',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      'consumer.ts',
    ],
    temporary,
  );
  console.log('Installed tarballs: public TypeScript declarations passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
