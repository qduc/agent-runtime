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
  for (const name of ['wire']) {
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
`,
  );
  console.log(run(process.execPath, ['consumer.mjs'], temporary).trim());
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
