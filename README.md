# Agent Runtime

TypeScript packages for building agent applications: a headless runtime and
registries, plus versioned event and interaction contracts.

| Package                                       | Purpose                                                                                | API status                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`@qduc/agent-wire`](packages/wire/README.md) | Dependency-free event parsing, interaction DTOs, and configuration receipts            | Schema v1 and explicit v2 APIs; applications own transport and persistence                                       |
| [`@qduc/agent-core`](packages/core/README.md) | Session runtime, provider and web-search registries, account stores, and prompt assets | Preliminary API; registry factories are public, but session construction still requires unexported collaborators |

Both packages are ESM-only, require Node.js 20+, and are MIT licensed. Package
versions and wire schema versions are separate; see the manifests for package
versions and the [wire migration guide](packages/wire/docs/migration-v1-v2.md)
for compatibility. Source availability does not imply npm publication.

## Choose a package

**Use agent-wire** to validate events exchanged between an agent host and its
clients. It distinguishes accepted event batches from transient live updates;
it does not run an agent, accept work, or create a replay log.

```ts
import { parseAgentEventEnvelopeV2 } from "@qduc/agent-wire";

const event = parseAgentEventEnvelopeV2({
  schemaVersion: 2,
  kind: "live",
  sessionId: "session-1",
  changes: [
    { type: "reasoning_delta", payload: { delta: "Considering options" } },
  ],
});
```

**Use agent-core's registry factories** to create separate provider, web-search,
and account-store instances. Its exported `createSessionRuntime` is not yet a
turnkey composition API: required option types refer to collaborators that the
package does not export. See [core API boundaries](docs/core-migration-scope.md)
before building a session integration. Neither package supplies a CLI, hosted
service, UI, or complete application sandbox.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm smoke
pnpm smoke:checkout
```

- `build` compiles both packages and copies core's prompt assets.
- `typecheck` checks source and test declarations; `test` runs package and
  release-safety tests.
- `smoke` packs and installs both packages in a temporary consumer, then checks
  runtime imports and public TypeScript declarations without `skipLibCheck`.
- `smoke:checkout` verifies committed HEAD in an isolated temporary clone. It
  requires a commit and network access; uncommitted changes are not included.

Isolation matters: a parent workspace's dependencies can otherwise mask missing
package dependencies. CI runs both checkout and installed-tarball checks.

## Repository layout

```text
packages/core   Runtime implementation, registry factories, and prompt assets
packages/wire   Versioned event and interaction contracts
scripts         Package smoke checks and release-safety tests
docs            API boundaries, implementation history, and release runbook
```

The public entry points are `packages/core/src/index.ts` and
`packages/wire/src/index.ts`. Core's implementation lives under
`packages/core/src/source/`; that directory is internal, not a supported deep
import API.

## Releases

The [release runbook](docs/release.md) describes validation, tarball preparation,
and manual npm publication through GitHub Actions. Publication requires explicit
release authorization and the configured environment and Trusted Publisher
permissions; a build or package installation does not publish anything.
