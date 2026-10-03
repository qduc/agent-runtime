import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'agent-runtime-checkout-'));
const checkout = join(temporary, 'repository');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: '', NODE_ENV: 'test' },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

try {
  // Use committed source and a path outside the source repo's dependency tree.
  run('git', ['clone', '--quiet', '--no-hardlinks', root, checkout], root);
  for (const args of [['install', '--frozen-lockfile'], ['build'], ['typecheck'], ['test']]) {
    run('pnpm', args, checkout);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
