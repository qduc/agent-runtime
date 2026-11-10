# Release runbook

Packages are prepared and published from `qduc/agent-runtime`. Publication is
manual: `.github/workflows/publish-agent-packages.yml` builds and validates
packages, uploads tarballs, then optionally publishes those same artifacts.
Pushes, pull requests, and the default workflow inputs do not publish anything.

## Configuration

| Setting         | Value                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository      | `qduc/agent-runtime`                                                                                                                                 |
| Workflow        | `publish-agent-packages.yml`, named "Prepare or publish agent packages"                                                                              |
| Dispatch ref    | `main` (the validate job refuses other refs)                                                                                                         |
| Inputs          | `package`: `wire` (default), `core` or `both`; `publish`: boolean (default `false`)            |
| Validation      | Frozen install, isolated checkout smoke, build, typecheck, tests, installed-tarball smoke; wire and core are packed and uploaded as `agent-packages` |
| Publish gate    | `inputs.publish`, GitHub environment `npm-agent-packages`, and `id-token: write`                                                                     |
| Publish command | Direct `npm publish` of the selected validated tarballs with `--access public --provenance` (core adds `--tag next`); no rebuild in the publish job |

Core is a prerelease and is always published to the `next` dist-tag, so
`npm install @qduc/agent-core` without a tag does not pick it up. Its source is
developed in Term2 (`packages/agent-harness-core`); before a core release, copy
that `src/` and `README.md` here and bump the version in the same change. Core
requires Node.js 24+; the installed-tarball smoke runs two concurrent turns.

Wire is ESM-only, MIT licensed, and requires Node.js 20+. Its package
version comes from its manifest, independently of wire schema versions. The
tarball includes `dist` and version-contract `docs`.
The [wire migration guide](../packages/wire/docs/migration-v1-v2.md) describes
consumer compatibility; publishing does not migrate or activate an application.

## Check prerequisites

Before authorizing a release, confirm:

1. The intended commits and package versions are on GitHub `main`.
2. The GitHub environment `npm-agent-packages` exists with the desired protection
   rules. Repository existence does not establish that this environment is set up.
3. The publisher owns the `@qduc` npm scope. If npm requires an authenticated first
   publication before package settings exist, handle that separately with the
   validated tarballs. Never commit a long-lived npm token.
4. Each selected package (including `@qduc/agent-core` before its first release) has an npm Trusted Publisher mapping for GitHub user
   `qduc`, repository `agent-runtime`, workflow `publish-agent-packages.yml`,
   environment `npm-agent-packages`. Direct npm publishing must be enabled;
   staged-publishing permission alone is insufficient for this workflow.
5. The intended versions have not already been published. This document does not
   assert current registry visibility or that publisher mappings are configured.

## Validate and publish

Run the workflow on `main` with `publish` left false to prepare and validate
artifacts without publishing. Inspect the result and the `agent-packages`
artifact. A publication run requires explicit authorization: set `publish` true
and satisfy the environment protection rules.
That run validates and packs its own artifacts before publication.

The separate CI workflow runs validation on pushes and pull requests, without a
publish job. `pnpm smoke:checkout` checks committed HEAD outside the current
workspace's dependency tree; this catches dependencies accidentally inherited
from a parent project. Installed-tarball smoke also checks public declarations
without `skipLibCheck`. Both checks matter: a successful source build alone does
not prove a clean consumer can import the package.

Do not republish a version that succeeded. Registry visibility can lag a successful
publication; an immediate 404 is not a reason to repeat it or invent a version.
