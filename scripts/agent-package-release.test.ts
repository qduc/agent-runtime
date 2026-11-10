import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('agent-runtime package release safety', () => {
  const workflow = parse(readFileSync('.github/workflows/publish-agent-packages.yml', 'utf8'));

  it('does not publish on pushes or by default', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
    expect(workflow.jobs.validate.if).toBe("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.publish.needs).toBe('validate');
    expect(workflow.jobs.publish.if).toBe('inputs.publish');
    expect(workflow.jobs.publish.environment).toBe('npm-agent-packages');
    expect(workflow.jobs.publish.permissions['id-token']).toBe('write');
  });

  it('publishes the validated tarballs rather than rebuilding on the publish runner', () => {
    const commands = workflow.jobs.publish.steps.flatMap((step: { run?: string }) => (step.run ? [step.run] : []));
    expect(commands).toEqual([
      'npm publish release-artifacts/qduc-agent-wire-*.tgz --access public --provenance',
      'npm publish release-artifacts/qduc-agent-core-*.tgz --access public --provenance --tag next',
    ]);
    expect(
      workflow.jobs.validate.steps.some(
        (step: { run?: string }) => step.run === 'node scripts/agent-package-smoke.mjs',
      ),
    ).toBe(true);
  });

  it('publishes only the package selected on dispatch, defaulting to wire alone', () => {
    const input = workflow.on.workflow_dispatch.inputs.package;
    expect(input.default).toBe('wire');
    expect(input.options).toEqual(['wire', 'core', 'both']);
    const conditions = Object.fromEntries(
      workflow.jobs.publish.steps
        .filter((step: { run?: string }) => step.run)
        .map((step: { name: string; if: string }) => [step.name, step.if]),
    );
    expect(conditions).toEqual({
      'Publish wire': "inputs.package == 'wire' || inputs.package == 'both'",
      'Publish core': "inputs.package == 'core' || inputs.package == 'both'",
    });
  });

  it('keeps core prereleases off the latest dist-tag', () => {
    const manifest = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
    expect(manifest.version).toMatch(/-/);
    expect(manifest.publishConfig.tag).toBe('next');
  });

  it('keeps Term2-wide validation out of this repository', () => {
    const commands = workflow.jobs.validate.steps.flatMap((step: { run?: string }) => (step.run ? [step.run] : []));
    for (const command of commands) {
      expect(command).not.toMatch(/test:integration|test:e2e|test:provider-black-box|test:changed|ripgrep/);
    }
  });

  for (const name of ['wire', 'core']) {
    it(`makes ${name} packable with a release version and public metadata`, () => {
      const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
      expect(manifest.name).toBe(`@qduc/agent-${name}`);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(manifest.license).toBe('MIT');
      expect(manifest.publishConfig.access).toBe('public');
      expect(manifest.scripts.prepack).toBe('pnpm run build');
      expect(manifest.repository.directory).toBe(`packages/${name}`);
      expect(readFileSync(`packages/${name}/LICENSE`, 'utf8')).toBe(readFileSync('LICENSE', 'utf8'));
    });
  }
});
