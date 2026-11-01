# qduc/agent-runtime

Independent, publishable agent runtime packages extracted from Term2:

- **`@qduc/agent-core`** — headless session runtime, provider/web-search/account
  registries, session composition graph, and bundled prompt assets.
- **`@qduc/agent-wire`** — dependency-free agent event and interaction wire
  contracts.

Both packages are ESM-only, require Node.js 20+, and publish to npm as MIT.

## Wire version status

Wire package source0.2.0 retains event schema1 and interaction DTOversion1 and
adds explicit event/configure schema2 APIs. See the [wire package version
ledger](packages/wire/docs/migration-v1-v2.md) and its separate v1/v2 contract
documents. This is source-only preparation, not a published version, built
artifact, migrated consumer, or canonical endpoint activation claim. Core source
remains0.1.0. Packaging and verification for this change are deferred until all
M6 implementation is complete.

## Repository layout

```
packages/core   @qduc/agent-core  (source under packages/core/src/source, mirroring the Term2 tree)
packages/wire   @qduc/agent-wire  (self-contained wire protocol)
scripts         tarball smoke test + release-safety tests
docs            extraction provenance, retained-coupling notes, release runbook
```

`packages/core/src/source/...` intentionally preserves the original Term2
directory layout so extracted files keep byte-identical relative imports.
Only the package entry (`packages/core/src/index.ts`) was rewritten to point at
the in-package tree.

## Development

```sh
pnpm install
pnpm build       # compile both packages (core also copies prompt assets to dist)
pnpm typecheck   # strict tsc over source + tests
pnpm test        # unit tests for both packages + release-safety tests
pnpm smoke       # pack both tarballs, install them into a temp consumer, run runtime + strict tsc checks
pnpm smoke:checkout # rebuild/typecheck/test committed HEAD in an isolated temporary git clone
```

The checkout gate requires a commit and network access. It runs outside any
parent application's dependency tree, preventing a nested checkout from hiding
missing build-time dependencies. CI and release validation both run this gate.

## Publishing

Publication is manual only: `.github/workflows/publish-agent-packages.yml`
(`workflow_dispatch`, `publish` input defaults to false) validates and packs
tarballs on `main`, then the publish job — gated by the GitHub environment
`npm-agent-packages` and `id-token: write` — runs direct `npm publish ... --access
public --provenance` on the validated tarballs. Exact npm fields, inputs, and
the one-time owner setup this bootstrap could not perform (GitHub repo,
environment, npm Trusted Publisher mapping) are in
[docs/release.md](docs/release.md).

## Provenance

Extracted from Term2 at source snapshot `63fbfd8a` (release preparation commit
`41de330f`). The dependency closure was computed with the TypeScript compiler
API (structured module resolution, not regex): 409 TypeScript files plus 46
prompt asset files. See [docs/core-migration-scope.md](docs/core-migration-scope.md)
for what was retained and the concrete limits on consumers.

## Current limits (read before consuming)

This repository is publication-ready and independently installable, but it is
**not** yet a completed Term2 core-ownership migration:

- `CreateConversationSessionOptions` still names concrete Term2 classes in its
  option surface (for example the required `toolOwnership: ToolOwnershipRegistry`,
  and internals such as `ToolApprovalPolicyRegistry` behind optional options).
  Those classes are **internal to the package**: the public entry exports no
  collaborator constructors, and the `exports` map exposes only the root entry,
  so deep imports cannot reach them. Consequently `createSessionRuntime` is
  exported but is **not yet a turnkey consumable composition API** — an external
  consumer cannot currently construct valid options at all; Term2 composes
  sessions from inside its own tree where those constructors are reachable.
  Nothing was cast away or type-weakened to hide this; fixing it is public-API
  work owned separately.
- Several extracted modules keep process-wide state (module-level provider
  registry singletons, the active-workspace-root lease counter, profile/settings
  caches). Term2 cannot switch to this package's `createSessionRuntime` without
  duplicating that state in one process. Details and evidence:
  [docs/core-migration-scope.md](docs/core-migration-scope.md).
