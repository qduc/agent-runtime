# Getting Started

**Run a schema-checked agent-event consumer in your own project.**

This guide uses `@qduc/agent-wire` to distinguish accepted changes from live
progress and reject packets that do not belong to your session. No model
account, API key, browser framework, or running agent is required.

## Prerequisites

- **Node.js 22.13+ to build this checkout; Node.js 24 is recommended** and is
  used by CI and the verified example run.
- Git and pnpm 11.7.0 for building this repository.
- npm for installing the tarball in the example project. You can use another
  package manager in your own application.

The packages themselves declare Node.js 20+ as their runtime requirement. The
newer source-build requirement comes from pnpm 11.7.0, which needs Node.js
22.13+; it does not change the packages' declared runtime target.

The packages were not publicly resolvable on npm when this guide was verified.
Use the source-built tarball route below rather than assuming a registry release.
The filenames shown match wire 0.2.2 and core 0.1.0; if a manifest version has
changed, use the filename printed by `pack`.

## 1. Build the wire package

Start in a directory where you want to keep two sibling folders: the package
checkout and a small consumer project.

```sh
git clone https://github.com/qduc/agent-runtime.git
cd agent-runtime
pnpm install --frozen-lockfile
pnpm --filter @qduc/agent-wire build
mkdir -p release-artifacts
pnpm --filter @qduc/agent-wire pack --pack-destination "$PWD/release-artifacts"
```

This produces `release-artifacts/qduc-agent-wire-0.2.2.tgz`. Building and packing
are local operations, not npm publication.

## 2. Install it in a separate project

From the package checkout above:

```sh
cd ..
mkdir wire-demo
cd wire-demo
npm init -y
npm pkg set type=module
npm install ../agent-runtime/release-artifacts/qduc-agent-wire-0.2.2.tgz
```

For an existing ESM project, install the same tarball using its absolute or
relative path. Wire has no runtime dependencies and does not need core.

## 3. Validate and handle events

Save this as `demo.mjs` in `wire-demo`:

```js
import { AgentWireError, parseAgentEventEnvelopeV2 } from "@qduc/agent-wire";

const sessionId = "session-1";

// Fixtures: the accepted packet represents a boundary already accepted by a host.
// Creating this object does not accept work or persist a session.
const live = {
  schemaVersion: 2,
  kind: "live",
  sessionId,
  changes: [
    { type: "reasoning_delta", payload: { delta: "Considering options" } },
  ],
};
const accepted = {
  schemaVersion: 2,
  kind: "accepted",
  sessionId,
  seq: 7,
  occurredAt: "2026-11-01T12:00:00.000Z",
  changes: [
    { type: "notice", payload: { kind: "info", message: "Answer stored" } },
  ],
};

const packets = [
  JSON.stringify(live),
  JSON.stringify(accepted),
  JSON.stringify({ ...live, sessionId: "another-session" }),
  JSON.stringify({ ...accepted, seq: 0 }),
  "not JSON",
];

for (const raw of packets) {
  try {
    const event = parseAgentEventEnvelopeV2(JSON.parse(raw), sessionId);
    const names = event.changes.map((change) => change.type).join(", ");

    if (event.kind === "accepted") {
      console.log(`accepted #${event.seq}: ${names}`);
    } else {
      console.log(`live: ${names}`);
    }
  } catch (error) {
    if (error instanceof AgentWireError || error instanceof SyntaxError) {
      console.log("rejected packet");
    } else {
      throw error;
    }
  }
}
```

Run it:

```sh
node demo.mjs
```

Expected output:

```text
live: reasoning_delta
accepted #7: notice
rejected packet
rejected packet
rejected packet
```

The last three packets demonstrate a wrong session, an invalid accepted sequence,
and invalid JSON. Syntax errors come from `JSON.parse`; structural contract
failures use `AgentWireError`. The same package imports work in TypeScript and
include declarations—no separate `@types` package is needed.

## 4. Connect it to your application

Replace the fixture packets with JSON received from your host. For WebSockets,
parse each complete message; for SSE, first decode frames and take their JSON
`data` payload. Wire does not implement either transport or SSE framing.

- **On the producer:** use actual session IDs, accepted sequences, timestamps,
  and public payloads from your application's acceptance boundary. Do not turn a
  live update into an accepted event just by attaching a counter.
- **On the consumer:** pass the expected session ID to the parser. Apply all
  changes in one accepted envelope as one batch; if you persist a replay cursor,
  advance it only after successfully applying the batch. Live envelopes have no
  accepted cursor and must not advance it.
- **For reconnects:** accepted sequences can be sparse—`7` does not imply that
  the next public boundary is `8`. Your host owns ordering, replay availability,
  and recovery. Raw reasoning and intermediate progress may be live-only.
- **At your domain boundary:** the parser validates envelopes and selected
  payload structures, not every goal, notice, price, or provider-specific object.
  Keep your application validation, authorization, and safe public projection.

This demo only logs validated events. It is not a session store, authenticated
transport, event-applier implementation, or working agent loop.

See [schema v2](../packages/wire/docs/v2.md) for the complete contract and
[v1 → v2 migration](../packages/wire/docs/migration-v1-v2.md) for compatibility.
The unqualified `parseAgentEventEnvelope` still means v1; v1 and v2 parsers do
not silently convert between versions.

## Optional: try the core registry factories

Core is for host-side building blocks, not required for the wire example. Its
registry factories are usable, but `createSessionRuntime` cannot yet be composed
externally through the supported public API.

From `wire-demo`, build and install the core tarball:

```sh
cd ../agent-runtime
pnpm --filter @qduc/agent-core build
pnpm --filter @qduc/agent-core pack --pack-destination "$PWD/release-artifacts"
cd ../wire-demo
npm install ../agent-runtime/release-artifacts/qduc-agent-core-0.1.0.tgz
```

Core includes native dependencies; you may need platform build tools if a
prebuilt binary is unavailable. Save the example from the
[core README](../packages/core/README.md#install-and-try-the-registry-factories)
as `registries.mjs` and run:

```sh
node registries.mjs
```

Expected output:

```text
Demo provider
undefined
account-a
```

This demonstrates independent registry membership and an in-memory account
store, not authentication or inference. Before adopting the session runtime,
read [its API boundaries](core-migration-scope.md).
