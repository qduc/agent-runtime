# @qduc/agent-wire

Dependency-free agent event and interaction wire contracts. Requires Node.js 20
or later. This is an ESM-only package with TypeScript declarations and no
runtime dependencies.

```ts
import { parseAgentEventEnvelope } from '@qduc/agent-wire';

const event = parseAgentEventEnvelope({
  schemaVersion: 1,
  id: 1,
  sessionId: 'session-1',
  type: 'turn_completed',
  occurredAt: '2026-10-03T00:00:00Z',
  payload: {},
});
```

Exports include `AGENT_EVENT_TYPES`, `AgentEventEnvelope`,
`parseAgentEventEnvelope`, `validatePendingInteractionDto`, and `AgentWireError`.
Envelope parsing validates the envelope structure and event identity, not the
event-specific payload schema. Applications still own payload validation,
authentication, authorization, and transport behavior.

Provenance: the implementation was extracted from Term2's `packages/wire`
(source snapshot `63fbfd8a`); the frozen event-type set is pinned by test.

The `0.1.x` API is preliminary.
