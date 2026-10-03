# Release runbook

Publication is manual only: a `workflow_dispatch` GitHub Actions workflow builds,
validates, and uploads tarballs, then a gated publish job runs direct `npm
publish` on the validated artifacts. Nothing publishes on push, on schedule, or
by default.

## Exact configuration this bootstrap produced

| Thing | Exact value |
| --- | --- |
| GitHub repository | `qduc/agent-runtime` (all `repository.url` fields: `https://github.com/qduc/agent-runtime.git`) |
| Workflow | `.github/workflows/publish-agent-packages.yml`, name "Prepare or publish agent packages", `workflow_dispatch` only |
| Dispatch inputs | `package`: `both` \| `wire` \| `core` (default `both`); `publish`: boolean (default `false`) |
| Validate job | runs on `main` only; `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `node scripts/agent-package-smoke.mjs`, packs both tarballs, uploads the `agent-packages` artifact |
| Publish job | `needs: validate`, `if: inputs.publish`, GitHub **environment `npm-agent-packages`**, permissions `id-token: write` (npm provenance/OIDC) |
| Publish steps | `npm publish release-artifacts/qduc-agent-wire-*.tgz --access public --provenance` and `npm publish release-artifacts/qduc-agent-core-*.tgz --access public --provenance` (validated tarballs are reused; the publish runner never rebuilds) |
| Packages | `@qduc/agent-wire@0.1.0`, `@qduc/agent-core@0.1.0`, both `"license": "MIT"`, `"publishConfig": { "access": "public" }`, `engines.node >=20`, ESM-only, `files: ["dist"]` |

A separate plain CI workflow (`.github/workflows/ci.yml`) runs the same
validation on push/PR without any publish capability. Term2's repo-wide
validation suites are deliberately absent from this repository.

## One-time setup this bootstrap could not do (owner assistance required)

This repository was bootstrapped locally; no GitHub repository, environment, or
npm mapping was created or contacted. Before the first publish, the owner must:

1. Push this repository to `github.com/qduc/agent-runtime`.
2. Create the GitHub **environment `npm-agent-packages`** with any desired
   reviewers/protection rules.
3. Register npm **Trusted Publisher** mappings for `@qduc/agent-wire` and
   `@qduc/agent-core` pointing at this repository and
   `.github/workflows/publish-agent-packages.yml` (npm OIDC provenance requires
   it; the publish input fails closed without it).

Then: run the workflow, keep `publish` unticked to rehearse validation, and tick
`publish` (after the environment gate) to release.
