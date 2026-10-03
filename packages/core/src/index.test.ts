import { describe, expect, it } from 'vitest';
import {
  createProviderRegistry,
  createSessionAccountStore,
  createSessionRuntime,
  createWebSearchRegistry,
} from './index.js';
import {
  createMockAgentClient,
  createMockSettingsService,
  mockLogger,
  sessionContextService,
} from './source/services/session/test-helpers/conversation-session-fixtures.js';
import { ToolOwnershipRegistry } from './source/services/approval/tool-ownership-registry.js';

describe('provider registry behavior', () => {
  const definition = (id: string, label = id) => ({
    id,
    label,
    fetchModels: async () => [] as Array<{ id: string; name?: string }>,
  });

  it('keeps instance-local registrations isolated between registries', () => {
    const first = createProviderRegistry();
    const second = createProviderRegistry();
    first.upsertProvider(definition('isolated-provider', 'Isolated'));
    expect(first.getProvider('isolated-provider')).toBeDefined();
    expect(second.getProvider('isolated-provider')).toBeUndefined();
  });

  it('seeds every fresh registry with the same builtin provider definitions', () => {
    // Provider modules in the copied graph register builtins at import time
    // (source/providers/index.ts side-effect imports); each registry starts
    // from that snapshot. Only instance-local entries differ.
    const first = createProviderRegistry();
    const second = createProviderRegistry();
    expect(first.getProviderIds().sort()).toEqual(second.getProviderIds().sort());
    expect(first.getProviderIds().length).toBeGreaterThan(0);
  });

  it('rejects duplicate registration unless override is allowed', () => {
    const registry = createProviderRegistry();
    registry.registerProvider(definition('duplicate', 'First'));
    expect(() => registry.registerProvider(definition('duplicate', 'Second'))).toThrow(
      "Provider 'duplicate' is already registered",
    );
    registry.registerProvider(definition('duplicate', 'Override'), { allowOverride: true });
    expect(registry.getProvider('duplicate')?.label).toBe('Override');
    registry.upsertProvider(definition('duplicate', 'Upserted'));
    expect(registry.getProvider('duplicate')?.label).toBe('Upserted');
  });

  it('lists, unregisters, and reports provider ids', () => {
    const registry = createProviderRegistry();
    registry.registerProvider(definition('a', 'A'));
    registry.registerProvider(definition('b', 'B'));
    expect(registry.getProviderIds()).toEqual(expect.arrayContaining(['a', 'b']));
    registry.unregisterProvider('a');
    expect(registry.getProvider('a')).toBeUndefined();
    const ids = registry.getAllProviders().map((provider) => provider.id);
    expect(ids).toContain('b');
    expect(ids).not.toContain('a');
  });
});

describe('web search and account store isolation', () => {
  it('returns distinct registries and account stores per call', () => {
    expect(createWebSearchRegistry()).not.toBe(createWebSearchRegistry());
    expect(createSessionAccountStore()).not.toBe(createSessionAccountStore());
  });
});

describe('public session runtime factory', () => {
  it('composes a runtime with an identity and a usable lifecycle surface', async () => {
    const runtime = createSessionRuntime({
      sessionId: 'runtime-test',
      agentClient: createMockAgentClient(),
      toolOwnership: new ToolOwnershipRegistry(),
      deps: {
        logger: mockLogger,
        settingsService: createMockSettingsService(),
        sessionContextService,
      },
    });
    expect(runtime.sessionId).toBe('runtime-test');
    expect(typeof runtime.sessionStartedAt).toBe('string');
    expect(typeof runtime.turns.start).toBe('function');
    expect(typeof runtime.compactContext).toBe('function');
    expect(typeof runtime.shutdown).toBe('function');
    await runtime.shutdown();
  });

  it('keeps two composed runtimes independent', async () => {
    const first = createSessionRuntime({
      sessionId: 'runtime-first',
      agentClient: createMockAgentClient(),
      toolOwnership: new ToolOwnershipRegistry(),
      deps: { logger: mockLogger, settingsService: createMockSettingsService(), sessionContextService },
    });
    const second = createSessionRuntime({
      sessionId: 'runtime-second',
      agentClient: createMockAgentClient(),
      toolOwnership: new ToolOwnershipRegistry(),
      deps: { logger: mockLogger, settingsService: createMockSettingsService(), sessionContextService },
    });
    expect(first.sessionId).toBe('runtime-first');
    expect(second.sessionId).toBe('runtime-second');
    await first.shutdown();
    expect(second.sessionId).toBe('runtime-second');
    await second.shutdown();
  });
});
