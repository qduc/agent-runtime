# @qduc/agent-wire

**One event contract for your agent host and every client.**

When your agent streams progress, completes work, or asks for input, its clients
need more than JSON with a `type` field. They need shared types, a way to reject
malformed packets, and a clear distinction between accepted changes and live
updates that may disappear after a disconnect.

`agent-wire` supplies versioned TypeScript contracts and structural parsers for
that boundary. Use it in a host, a browser client, a terminal client, or an
intermediary without taking on an agent runtime, model provider, or UI framework.
It is dependency-free, ESM-only, and requires Node.js 20+.

## What it buys you

- Shared event and interaction shapes instead of maintaining a separate copy per client.
- Schema v2 accepted batches and cursorless live envelopes, with distinct types.
- Envelope validation, optional expected-session checks, and selected payload validation.
- Explicit v1 compatibility instead of silently converting between schemas.

It does **not** implement an event store, reconnect loop, authentication, or
full domain validation. The producer remains responsible for truthfully reporting
accepted work; passing a parser is not proof that anything was persisted.

## Get started

**[Install and run the complete example →](https://github.com/qduc/agent-runtime/blob/main/docs/getting-started.md)**

The guide builds a local tarball and installs it into a separate project; npm
registry installation is not assumed available. After installation:

```ts
import { parseAgentEventEnvelopeV2 } from "@qduc/agent-wire";

const event = parseAgentEventEnvelopeV2(
  {
    schemaVersion: 2,
    kind: "live",
    sessionId: "session-1",
    changes: [
      { type: "reasoning_delta", payload: { delta: "Considering options" } },
    ],
  },
  "session-1"
);

console.log(event.kind); // live
```

This fixture is a live update, not a persisted event. The guide also demonstrates
accepted batches, session mismatch rejection, malformed input, and where to
connect your own transport.

## Choose an explicit contract

- [Schema v1](docs/v1.md): unchanged `AgentEventEnvelope`, `AGENT_EVENT_TYPES`,
  `parseAgentEventEnvelope` / `parseEventEnvelope`, existing strict interaction
  DTO v1 and its validator. These unqualified exports still mean v1.
- [Schema v2](docs/v2.md): named `AgentEventEnvelopeV2`, `AgentChangeV2`,
  `parseAgentEventEnvelopeV2`; atomic accepted batches with real sparse seq/at,
  separate live-only envelopes, aggregate queue/rotation/native compaction,
  and `AgentConfigureResultV2` / `parseAgentConfigureResultV2` native receipts.
- [Version ledger, migration and rollback](docs/migration-v1-v2.md): package vs
  schema versions, local artifact route and producer and consumer handoffs.

Neither parser fabricates
identity/time, journals events or restores execution. Applications own transport,
authentication/authorization, safe payload projection and actual acceptance/replay.
V2 adds structural native seam validation, not a claim of full payload validation
or native replay parity for data never accepted. All parser failures use the
retained `AgentWireError`; versions never silently convert or fall back.

V2 has an explicit raw-stream replay exception: raw reasoning and intermediate
tool progress are live-only and may be lost after reconnect/crash. Recovery uses
actual accepted summaries and final tool results, not a restored raw prefix.
This is not full replay parity and does not authorize stripping provider-native
reasoning items/signatures/encrypted metadata or tool calls/results. See the
[v2 retention contract](docs/v2.md#explicit-raw-stream-replay-exception-option-b).
Applications must verify provider continuation through their own execution and
recovery paths; structural parsing alone cannot establish it.
Accepted tool_called retains actual call identity without asserting physical
execution. Runtime error is live-only (accepted error rejects); a separate
native-backed live turn_failed may settle transient visible lifecycle state,
never an accepted cursor or durable terminal. General change types cover both
kinds; accepted envelope changes stay restricted to accepted types.

V2 task changes include native `task_question_opened`/`task_question_closed`
and strict optional task `pendingQuestion` snapshots. Producers must preserve
these accepted facts rather than relabeling or dropping them; see the
[task descriptor contract](docs/v2.md#accepted-messages-and-task-descriptors).
