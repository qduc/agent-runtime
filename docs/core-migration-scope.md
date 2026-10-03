# Core extraction provenance and migration scope

## Source snapshot

- Extracted from Term2 at commit `63fbfd8a` ("Merge shared agent package release
  preparation"); the npm release preparation itself landed in `41de330f`
  ("Prepare shared agent packages for first npm release").
- Term2's `packages/core` and `packages/wire` at that commit were thin wrappers:
  `packages/wire` contained the full wire implementation, while `packages/core`
  re-exported a curated surface from `source/` (`source/core/session-runtime.ts`,
  `source/services/session/session-composition.ts`, `source/providers/registry.ts`,
  `source/providers/web-search/registry.ts`, `source/providers/oauth-session-account.ts`).

## How the closure was computed

`.coord/closure.mjs` (kept out of the published repo) walked the import graph
from `packages/core/src/index.ts` using the TypeScript compiler API:
`ts.createSourceFile` + AST visitors for import/export declarations and dynamic
`import()` calls, resolved with `ts.resolveModuleName` under `NodeNext`. No
regex-based extraction. Results (snapshot `63fbfd8a`):

- 409 local TypeScript files copied into `packages/core/src/source/...`
  (Term2 layout preserved verbatim; only `index.ts` specifiers rewritten to
  `./source/...`).
- 46 prompt asset files copied (the whole `source/prompts` tree minus
  `*.test.ts`); the build copies them to `dist/source/prompts/` where the
  compiled profile/role loaders read them at runtime.
- External runtime dependencies (14): `@ai-sdk/provider`,
  `@anthropic-ai/sandbox-runtime`, `@openrouter/ai-sdk-provider`,
  `@qduc/web-fetch` (dynamically imported by the web tool), `ai`,
  `better-sqlite3` (session index), `env-paths`, `fast-deep-equal`, `ignore`,
  `jiti` (hook module loading), `openai`, `ssh2`, `unbash`, `zod`. (`ws` was
  declared in Term2's `packages/core` manifest but nothing in the closure
  imports it, so it is not carried over.)
- Unresolved relative imports: 0. Test/support entries added explicitly:
  `conversation-session.isolation.test.ts`,
  `conversation-session.lifecycle.test.ts`,
  `test-helpers/conversation-session-with-adapter.ts`,
  `services/test-helpers/mock-stream.ts`,
  `services/session/test-helpers/conversation-session-fixtures.ts`.

### The core manifest deliberately completes the dependency closure

Term2's `packages/core` manifest declared a **partial** dependency list: it
omitted `better-sqlite3`, `ignore`, `jiti`, `ssh2`, `@qduc/web-fetch`,
`@ai-sdk/provider`, and `@types/node-forge`, which installed anyway only because
the Term2 root `package.json` hoisted them into the workspace. This repository
has no root to lean on, so `packages/core/package.json` declares the full
closure from the compiler-API import graph above.

The strict tarball smoke test (consumer installs the packed tarballs and runs
`tsc --noEmit --strict` **without** `skipLibCheck`) is the proof that transitive
type dependencies are covered: on the first run it failed with
`sandbox-runtime/dist/sandbox/mitm-ca.d.ts: Could not find a declaration file
for module 'node-forge'`, and `@types/node-forge` was added to the manifest —
matching Term2's own earlier finding (its core manifest carries
`@types/node-forge` for exactly this reason). The test now passes.

## Why the layout is retained

The extracted sources keep Term2's `source/...` directory layout inside
`packages/core/src/source/` so that every relative import between extracted
files stays byte-identical to Term2. Restructuring into per-domain folders was
deferred until the API boundaries are re-cut on their own; doing it during the
mechanical extraction would have mixed a mechanical copy with a refactor and
made provenance diffing impossible.

## Retained app-coupled contracts

The closure is not a pure "runtime kernel"; several Term2 application contracts
came along because the session composition graph transitively requires them:

- **Settings/theme coupling.** `source/providers/registry.ts` imports
  `services/service-interfaces.ts`, whose settings schema pulls
  `services/settings/settings-schema.ts` → `theme/resolve-theme.ts` +
  `theme/palettes.ts` + `skins/names.ts`. A headless consumer therefore drags
  Term2's theme/palette/skin naming into its dependency graph (type-level;
  no terminal rendering is performed).
- **`source/agent.ts` coupling.** The subagent role loader imports
  `getEnvInfo`/`getAgentsInstructions` from `source/agent.ts`, so the entry
  module of the whole Term2 tool registration is part of the closure. It is
  inert unless invoked, but it is duplicated application code, not a
  package-owned seam.
- **Prompt assets.** Profile/role prompt construction reads `.md` assets from
  the compiled tree; these are bundled and packed.

These are recorded, not silently hidden: no source in this repository was
rewritten to decouple them in the extraction pass.

## Term2 core-ownership migration is NOT done

This repository being installable, buildable, testable, and packable does not
mean Term2 has been switched to consume it. Two independent blockers remain,
both observed in the snapshot:

1. **Duplicated stateful modules.** Extracted modules own process-wide state:
   - `source/providers/registry.ts`: module-level `builtinProviders` map and a
     `defaultProviderRegistry` singleton created at import time.
   - `source/services/workspace/active-workspace-root.ts`: module-level
     `activeRoot` and `liveSessionRuntimeCount` with a fail-closed guard that
     refuses a second published workspace root while runtimes are live.
   - Profile/settings resolution (`services/profiles/...`) reached through the
     session composition.

   If Term2 imported `@qduc/agent-core` while keeping its own `source/` copy,
   the process would hold **two** provider registries, **two**
   active-workspace-root counters, and duplicated profile/settings caches. The
   multi-runtime guard would then under-count (each copy sees only its own
   runtimes), which is exactly the failure mode the guard exists to prevent.

2. **Nominal collaborator types in the public options — and the constructors
   are not exported.**
   `CreateConversationSessionOptions` (the type of the public
   `createSessionRuntime` options) names concrete classes rather than
   structural interfaces:
   - `toolOwnership: ToolOwnershipRegistry` (required) — a class the consumer
     would have to instantiate from this package.
   - Optional `approvalPolicyRegistry?: ToolApprovalPolicyRegistry`, and the
     internals graph composes `ApprovalState` and `ToolApprovalPolicyRegistry`
     instances internally.
   - `agentClient: ConversationAgentClient` is an interface, but a headless
     consumer must implement its full surface (streaming, approval policy
     registry access, sinks) with no reference implementation exported.

   Worse, the collaborator classes are internal: `src/index.ts` exports only
   `createSessionRuntime`, the session port types, and the three registry
   factories — no `ToolOwnershipRegistry` or related constructors — and the
   package `exports` map exposes only the root entry, so deep imports cannot
   reach them. The result is that `createSessionRuntime` is exported but is
   **not yet a turnkey consumable composition API**: no external consumer can
   currently construct valid options. Term2 gets away with it because it
   composes from inside its own tree where the constructors are reachable.

   No casts or type weakening were introduced to hide this — the limitation is
   reported as-is. Term2's own fixtures
   (`conversation-session-fixtures.ts`, `conversation-session-with-adapter.ts`,
   both included under `src/source/...`) show how the collaborators are built
   internally; they are retained as provenance and seam evidence, not as an
   external API. De-nominalizing the option types and exporting (or replacing
   with structural interfaces) the collaborator constructors is public-API work
   owned separately.

Consequently: the wire package is a drop-in replacement for Term2's
`packages/wire` (its consumer was verified by the tarball smoke test), but
migrating Term2's session runtime to consume `@qduc/agent-core` requires first
splitting the stateful modules behind injectable seams and de-nominalizing the
session option types (and then exporting, or structurally typing, the
collaborator constructors). That migration is owned by the Term2 side, not by
this repository. Release mechanics for this repository are in
[release.md](release.md).
