# AGENTS.md

Monorepo of publishable agent-runtime packages extracted from Term2 (snapshot `63fbfd8a`).

- `packages/wire` — `@qduc/agent-wire`: dependency-free event/interaction wire contracts.
- `packages/core` — `@qduc/agent-core`: headless session runtime, provider/web-search/account registries. Source lives under `src/source/...` mirroring the Term2 tree; keep that layout and byte-identical relative imports. Only `src/index.ts` is the rewritten entry.
- `scripts/` — tarball smoke test (`agent-package-smoke.mjs`) and release-safety tests.
- `docs/release.md` — publish runbook; `docs/core-migration-scope.md` — extraction provenance and consumer limits.

Commands: `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm smoke` · `pnpm smoke:checkout` (needs a commit + network; validates HEAD in an isolated clone).

Conventions: ESM-only, Node >=20, TypeScript strict, pnpm workspace. Both packages publish to npm as `@qduc/*`, MIT, files limited to `dist`.

Publishing is manual via `.github/workflows/publish-agent-packages.yml` (workflow_dispatch; `publish` input defaults to false, gated by GitHub environment `npm-agent-packages` and npm provenance). Never commit npm tokens; see docs/release.md before publishing.

## Maintained public-interface documentation

Every large module must have a public-interface document maintained throughout
its life. The module's source owner keeps its public API, contracts and ownership
boundaries, compatibility/migration behavior, and limitations in sync with source
changes in the same change. Distinguish implemented source from verified,
packaged, installed or consumer-supported behavior; do not claim unverified support.
Prefer the appropriate existing module docs and link them from its README rather
than creating boilerplate for every small file or helper. When a cross-owner
interface changes, report the required downstream documentation and its owner;
do not silently claim that another owner's contract is updated.

For `packages/wire`, the existing public-interface documents are its `README.md`
and `docs/v1.md`, `docs/v2.md`, and `docs/migration-v1-v2.md`. Keep the retained
version contracts, native/application responsibilities and evidence limits current.
