# Local migration and compatibility: v1 → v2

## Version ledger

| Package source | Event API | Configure receipt API | Interaction DTO | Consumer status |
| --- | --- | --- | --- | --- |
| 0.1.0 | schema1, unqualified legacy exports | none in this package | version1 | Existing consumers; direct parity gaps remain |
| 0.2.0 | retained schema1 AND explicit named schema2 exports | explicit schema2 native configure wrapper | retained version1 | Source only; no new artifact/endpoint/browser acceptance yet |

Each contract: [v1](v1.md), [v2](v2.md). Package semantic version does not itself
negotiate an event or interaction schema. The unchanged v1 parser rejects v2;
the new v2 parsers reject v1. There is no implicit compatibility conversion.

## Local artifact route — no publication required

Authoritative source is agent-runtime, not a Term2 package fork. After the M6
implementation freeze lifts, the owner must build/validate/pack0.2.0 here, retain
its exact source identity and artifact integrity, and update Term2's root and
web-client vendored pins/lockfile together. Term2's embed step consumes the new
installed artifact. Do not hand-edit the0.1.0 tarball, restore this shared source
inside Term2, or require an npm publish for local development. Source delivery
alone does not create a tarball or installable changed dependency.

Build/pack/checks are explicitly DEFERRED during this implementation assignment.
No release, push, deploy or registry permission follows from this document.

## Consumer migration unit

1. Producer/native owners supply only real accepted identity/seq/at and actual
   payloads, plus native durable publication where reasoning/progress replay is
   required. Required replay data cannot be supplied by envelope design alone.
2. Protocol/server groups ALL public changes of ONE accepted boundary into ONE
   v2 accepted envelope, preserves aggregate arrays and rotation semantics,
   keeps live envelopes separate and adds explicit format/version negotiation.
   It must collect a complete boundary before publishing it, not flush each
   projected change separately. Source adapters that only expose per-change
   events must be extended at the real boundary, not time-window grouped.
3. Browser parses v2, validates application payloads, validates the single SSE ID
   equals accepted seq, rejects an SSE ID on live frames, stages/reduces the whole
   accepted batch atomically, and commits its view/cursor together. Sparse
   cursors are legal; repeated individual change IDs do not exist. Live events
   do not overwrite durable state/checkpoints. Reconnect replays from last
   committed accepted boundary; reload uses actual accepted projection cuts.
4. Browser/BFF/API/config callers migrate together: preserve caller mutation
   key/revision/patch, allow the real selection request, handle pending and
   native typed outcomes, and separate original receipt from current discovery.
   Updating a package constant, format query or success parser alone is not this
   migration. Preserve safe diagnostics and installed/profile intent semantics.
5. Coordinate external ChatForge/BFF consumers explicitly; changing the local
   salvaged browser does not establish external migration. Retained Term2 v1
   wire importers and interaction callers need compatibility/removal ownership;
   v1 data parsing support is not permission to run a legacy engine fallback.
6. Keep canonical stream/configuration gates honest until producers, artifact
   and supported consumers are coherently combined and independently verified.
   This source implementation does not activate routes or prove that condition.

## Evidence to collect after implementation is complete

Version rejection/v1 compatibility; atomic multi-message boundary and sparse
cursor reconnect; exact aggregate arrays/rotation without lost preserved state;
real accepted compaction payload optionality/crash correlation/no extra charge;
live frame non-durability and required native replayable progress; configure
pending/success/rejected/interrupted/nonreceipt errors, original outcomes across
later mutations, stable-key replay/conflict/stale/busy and discovery separation.
Run package build/typecheck/tests/tarball/public-import checks and the real
migrated server/browser workflow, including failure/reconnect paths, only when
authorized after the freeze. None are claimed by these docs.

## Rollback and storage

V2 envelopes change transport interpretation, not native Session storage format.
Their actual sequences must still refer to the sole accepted native log. Do not
create a second replay journal or edit/drop accepted facts to satisfy old parsers.
Old v1 readers cannot parse v2 and may also lack new native log vocabulary; source
rollback alone is not a persistence rollback. Retain compatible readers for logs
already written. Negotiate formats per compatible consumers; do not auto-downgrade
an incompatible active session, reconstruct old IDs or enable legacy execution.
No rollback/reopen/consumer compatibility exercise has been performed here.
