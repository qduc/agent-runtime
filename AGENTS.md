# AGENTS.md

Monorepo of publishable agent-runtime packages extracted from Term2 (snapshot `63fbfd8a`).

- `packages/wire` — `@qduc/agent-wire`: dependency-free event/interaction wire contracts.
- `packages/core` — `@qduc/agent-core`: headless session runtime, provider/web-search/account registries. Source lives under `src/source/...` mirroring the Term2 tree; keep that layout and byte-identical relative imports. Only `src/index.ts` is the rewritten entry.
- `scripts/` — tarball smoke test (`agent-package-smoke.mjs`) and release-safety tests.
- `docs/release.md` — publish runbook; `docs/core-migration-scope.md` — extraction provenance and consumer limits.

Commands: `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm smoke` · `pnpm smoke:checkout` (needs a commit + network; validates HEAD in an isolated clone).

Conventions: ESM-only, Node >=20, TypeScript strict, pnpm workspace. Both packages publish to npm as `@qduc/*`, MIT, files limited to `dist`.

Publishing is manual via `.github/workflows/publish-agent-packages.yml` (workflow_dispatch; `publish` input defaults to false, gated by GitHub environment `npm-agent-packages` and npm provenance). Never commit npm tokens; see docs/release.md before publishing.
