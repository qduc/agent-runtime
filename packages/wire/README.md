# @qduc/agent-wire

Dependency-free, ESM-only event/interaction contracts for Node.js20+.
Package source0.2.0 adds explicit schema2 APIs while retaining schema1 and
interaction DTOversion1. **Source delivery only:** no0.2.0 artifact or migrated
consumer support is claimed until packaging and consumer work is complete.

## Choose an explicit contract

- [Schema v1](docs/v1.md): unchanged `AgentEventEnvelope`, `AGENT_EVENT_TYPES`,
  `parseAgentEventEnvelope` / `parseEventEnvelope`, existing strict interaction
  DTOversion1 and its validator. These unqualified exports still mean v1.
- [Schema v2](docs/v2.md): named `AgentEventEnvelopeV2`, `AgentChangeV2`,
  `parseAgentEventEnvelopeV2`; atomic accepted batches with real sparse seq/at,
  separate live-only envelopes, aggregate queue/rotation/native compaction,
  and `AgentConfigureResultV2` / `parseAgentConfigureResultV2` native receipts.
- [Version ledger, migration and rollback](docs/migration-v1-v2.md): package vs
  schema versions, local artifact route and actual server/browser/BFF handoffs.

```ts
import { parseAgentEventEnvelopeV2 } from '@qduc/agent-wire';
const event = parseAgentEventEnvelopeV2({
  schemaVersion: 2, kind: 'live', sessionId: 'session-1',
  changes: [{ type: 'reasoning_delta', payload: { delta: 'Considering options' } }],
});
```

The example illustrates shape, not a persisted event. Neither parser fabricates
identity/time, journals events or restores execution. Applications own transport,
authentication/authorization, safe payload projection and actual acceptance/replay.
V2 adds structural native seam validation, not a claim of full payload validation
or native replay parity for data never accepted. All parser failures use the
retained `AgentWireError`; versions never silently convert or fall back.

Provenance: v1 was extracted from Term2 snapshot63fbfd8a and is retained as
`src/v1.ts`. V2 is authoritative shared source, not a Term2 vendored fork.
