# Core API boundaries and implementation notes

> Historical record: the core snapshot was retired from this repository. It is not a currently supported or publishable package.

`@qduc/agent-core` contains a headless session runtime, registry factories,
account stores, and prompt assets. It is independently buildable and packaged,
but its preliminary session-construction API still exposes internal collaborators.
The filename of this document is retained for existing links.

## Public API

`packages/core/src/index.ts` exports:

- `createProviderRegistry`, `createWebSearchRegistry`, and
  `createSessionAccountStore`, which create separate mutable instances.
- `createSessionRuntime` and session types, including
  `CreateConversationSessionOptions`, `SessionHandle`, `SessionRuntime`,
  `SessionSnapshot`, `SessionEvent`, and interaction/admission result types.

The package export map exposes only the root entry. Files under `src/source/`
and the corresponding `dist/source/` implementation are not supported deep
import APIs. Bundled prompt loaders resolve assets from `dist/source/prompts/`.

## Session construction is not yet an external composition API

`CreateConversationSessionOptions` requires `toolOwnership` of the concrete
`ToolOwnershipRegistry` class. Options also reference collaborators such as
`ToolApprovalPolicyRegistry`, `ToolRegistry`, and `SubagentManager`. Their class
constructors are not exported by the package entry; some have private fields
that prevent a structurally equivalent implementation from satisfying the type.

Consequently, exporting `createSessionRuntime` does not yet let an external
consumer compose a session through the supported public entry alone. This needs
public-API work, not a type assertion, weakened declaration, or deep import around
the export map. Registry factories are separately usable. The package does not
supply a ready-made chatbot, CLI, gateway, UI, or application-level tool sandbox.

## Instance isolation and process-wide state

Separate registry and account-store factories do not make every part of the
session implementation instance-local:

- `source/providers/registry.ts` retains `builtinProviders` and the
  `defaultProviderRegistry` singleton.
- `source/services/workspace/active-workspace-root.ts` retains `activeRoot` and
  `liveSessionRuntimeCount`; its guard refuses conflicting workspace publication
  while multiple runtimes are live. Explicitly injected roots take precedence.
- Session composition reaches profile/settings resolution and its caches.

An application that embeds a second copy of these modules can duplicate their
state and under-count active runtimes. Use a single implementation owner rather
than mixing package-managed sessions with copied runtime internals. A successful
package import or registry-isolation check is not proof of full session isolation.

## Internal dependencies

The session composition graph includes more than a minimal runtime kernel:

- Provider service interfaces reach settings, palette, theme, and skin names.
  This does not itself render a terminal UI.
- Subagent role loading imports environment/instruction helpers through
  `source/agent.ts`, which also participates in tool registration.
- System tools include shell/sandbox behavior, filesystem and workspace
  resolution, background task tracking, and current-directory policy.

These dependencies matter when designing a narrower session API. Internal layout
changes are possible, but should be separated from API-boundary work so ownership
and import behavior remain reviewable.

## Historical provenance

The notes below describe the initial source import, not a requirement to mirror
another repository or a statement of any application's current migration status.
They retain the dependency-discovery and layout rationale for future maintenance.

### Source snapshot

- Extracted from Term2 at commit `63fbfd8a` ("Merge shared agent package release
  preparation"); the npm release preparation itself landed in `41de330f`
  ("Prepare shared agent packages for first npm release").
- Term2's `packages/core` and `packages/wire` at that commit were thin wrappers:
  `packages/wire` contained the full wire implementation, while `packages/core`
  re-exported a curated surface from `source/` (`source/core/session-runtime.ts`,
  `source/services/session/session-composition.ts`, `source/providers/registry.ts`,
  `source/providers/web-search/registry.ts`, `source/providers/oauth-session-account.ts`).

### Dependency discovery

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

### Dependency declaration lessons

Term2's `packages/core` manifest declared a **partial** dependency list: it
omitted `better-sqlite3`, `ignore`, `jiti`, `ssh2`, `@qduc/web-fetch`,
`@ai-sdk/provider`, and `@types/node-forge`, which installed anyway only because
the Term2 root `package.json` hoisted them into the workspace. The package manifest was completed so consumers would not depend on a parent
application's hoisted dependencies.

The strict tarball smoke test (consumer installs the packed tarballs and runs
`tsc --noEmit --strict` **without** `skipLibCheck`) is the proof that transitive
type dependencies are covered: on the first run it failed with
`sandbox-runtime/dist/sandbox/mitm-ca.d.ts: Could not find a declaration file
for module 'node-forge'`, and `@types/node-forge` was added to the manifest —
matching Term2's own earlier finding (its core manifest carries
`@types/node-forge` for exactly this reason). The missing type dependency was added to the manifest.

### Layout rationale

The initial source import preserved the `source/...` directory layout inside
`packages/core/src/source/` so relative imports stayed unchanged. Restructuring was deferred in that import pass: mixing a mechanical copy with
an API/layout refactor would have made provenance diffing impossible. This
historical choice does not require future source changes to mirror Term2.
