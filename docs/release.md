# Release runbook

Publication is manual only: a `workflow_dispatch` GitHub Actions workflow builds,
validates, and uploads tarballs, then a gated publish job runs direct `npm
publish` on the validated artifacts. Nothing publishes on push, on schedule, or
by default.

## Current wire source preparation

Wire source0.2.1 retains the schema2 APIs introduced in0.2.0, plus schema1 and
interaction DTOversion1; core remains0.1.0. The0.2.1 patch corrects flat public
queue-submission validation. Each wire version, compatibility and
local-only consumer migration is documented in
[the wire package](../packages/wire/docs/migration-v1-v2.md). Wire's package file
list now includes `docs` as well as `dist` so those version contracts accompany a
future artifact. The bootstrap table below describes the original0.1.0 setup,
not a claim of0.2.1 publication or consumer acceptance. Authorized local
build/pack verification is separate from publication: it neither runs the
workflow nor authorizes a push, deployment or npm publish. Consumer installation
also remains subject to the current task resource restrictions.

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
3. Confirm ownership of the `@qduc` scope. Bootstrap a new package with an
   authenticated first publish only if npm requires it before package settings
   exist; this is a separate user-assisted step using validated tarballs. Never
   put a long-lived npm token in this repository.
4. Register npm **Trusted Publisher** mappings for each package: GitHub user
   `qduc`, repository `agent-runtime`, workflow filename
   `publish-agent-packages.yml` (filename only), environment `npm-agent-packages`.
   Explicitly enable **direct npm publish**; staged publishing permission alone
   does not authorize this workflow.

Validation also runs `pnpm smoke:checkout`: it installs, builds, typechecks, and
tests committed HEAD in a temporary clone outside the current dependency tree.
This gate caught missing SSH/WebSocket type dependencies that a nested checkout
under Term2 had accidentally inherited. The tarball smoke remains separate and
checks public declarations without `skipLibCheck`.

If one package succeeds and the other fails, retry only the failed package.
If a bootstrap already published `0.1.0`, do not republish that version. A
successful publish may precede npm read visibility by minutes; an immediate 404
does not justify repeating a successful publish or inventing another version.

Then: run the workflow, keep `publish` unticked to rehearse validation, and tick
`publish` (after the environment gate) to release.
