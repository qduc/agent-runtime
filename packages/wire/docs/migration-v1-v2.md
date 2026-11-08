# Migration and compatibility: v1 → v2

## Version ledger

| Package version | Event API                      | Configure receipt API | Interaction DTO | Change                                                                      |
| --------------- | ------------------------------ | --------------------- | --------------- | --------------------------------------------------------------------------- |
| 0.1.0           | Schema v1, unqualified exports | None                  | v1              | Original contract                                                           |
| 0.2.0           | Retained v1 + explicit v2      | Explicit v2 receipts  | Retained v1     | Atomic accepted batches and separate live envelopes                         |
| 0.2.1           | Same schema versions           | Same                  | Same            | Validate flattened queue-submission identity                                |
| 0.2.2           | Same schema versions           | Same                  | Same            | Accept native task-question lifecycle and strict pending-question snapshots |

This ledger describes package APIs, not registry visibility or application
activation. Check installed package versions separately from transport schemas.

Each contract: [v1](v1.md), [v2](v2.md). Package semantic version does not itself
negotiate an event or interaction schema. The unchanged v1 parser rejects v2;
the new v2 parsers reject v1. There is no implicit compatibility conversion.

The eight accepted-only cost/request_cost_recorded/goal/goal_proposed/
verification/notice/background_notice_enqueued/background_notices_delivered
names belong to the schema v2 contract. V1, the live allowlist, envelope fields and configure receipts
are unchanged. See [v2 accounting and scope](v2.md#accepted-cost-goals-and-notices):
root aggregate replacement and physical request upsert are distinct; neither
cost nor request_cost_recorded is branch-wrapped. Shared payload validation
remains structural, not a duplicate of native domain schemas.

Schema v2 also includes accepted-only `message` and `task_changed`
with bounded validation of their exact native public payload/descriptor keys.
Message is `{message,replacesDraftId?}` and retains actual root/branch scope,
message identity, content/text and optional ownership/flags/draft replacement.
Task is `{change,at,task}`; only task id/status are required descriptor fields.
Native optional fields stay optional, and result.toolUseCounts stays nested
(absent is unknown, [] known empty). Task metadata is root-scoped, not an extra
branch event. See [message/task contract](v2.md#accepted-messages-and-task-descriptors).
No terminal/status, completion, provider history or missing identity is inferred;
status_changed is excluded without a native accepted producer. This does not
alter v1/live/configure behavior, option B or enable either runtime gate.

A further same-version source completion adds accepted-only `tool_called`,
live-only `error`, and `turn_failed` to the live allowlist (the accepted failure
name already exists). Tool payload is `{tool}` with actual called execution/
turn/input identity and optional public call/result/display/content fields;
never infer physical execution from a call. Error is `{error:<native public
WireError>}`, connection-local and never accepted. The shared parser rejects
accepted error; do not widen the accepted allowlist for type compatibility.
`AgentAcceptedChangeTypeV2` describes that allowlist, while the general
`AgentChangeTypeV2`/`AgentChangeV2` also represent live-only error. Accepted
Envelope.changes is an Extract restricted to accepted types; live changes use
their own Extract. Narrow by envelope kind and align consumers/mirrors to these
actual APIs rather than casting a live error into accepted state.

The real null-seq synchronize failure maps to live turn_failed, not a fabricated
durable terminal. It can settle visible transient lifecycle state but never an
accepted checkpoint/history/result. Live error alone does not mutate durable
status/terminal. Hydration/current accepted state stays authoritative; no
status_changed is manufactured. See the [tool/failure contract](v2.md#accepted-tool-calls-and-live-runtime-failures).
The model_response_completed/budget_observed accepted audit gaps remain excluded
without client behavior; no full event-replay parity is implied.

## Local artifact route — no publication required

Build and validate replacement artifacts in this repository. For local testing,
pack the selected package and install that artifact in each affected consumer;
retain its source identity and integrity. If a consumer embeds the installed
package in its own build, rebuild that output too. Do not hand-edit tarballs or
maintain copied protocol implementations in consumers. An npm publication is
not required for local artifact testing, and source edits alone do not update
an installed dependency. Follow the repository's release runbook for publication.

## Consumer migration unit

1. Producer/native owners supply only real accepted identity/seq/at and actual
   payloads. Under the explicit option-B raw-stream replay exception, raw
   reasoning chunks and intermediate tool progress stay live-only, including
   after reconnect/crash; accepted summaries and final tool results are the
   recovery surface. Do not persist transient prefixes or invent history/cursors.
   Preserve complete provider-required reasoning items/signatures/encrypted
   metadata/tool calls/results independently of public presentation retention.
2. Protocol/server groups ALL public changes of ONE accepted boundary into ONE
   v2 accepted envelope, preserves aggregate arrays and rotation semantics,
   keeps live envelopes separate and adds explicit format/version negotiation.
   It must collect a complete boundary before publishing it, not flush each
   projected change separately. Explicitly map the eight raw public evidence
   names; aggregate cost replaces state and request records upsert by real
   requestId without another branch wrapper or duplicate charge. No aggregate
   is synthesized when a native producer is absent. Source adapters that only
   expose per-change events must be extended at the real boundary, not
   time-window grouped. Retain message/task_changed raw payloads as well;
   accepted message branch scope and root task ownership must not be invented.
3. Browser parses v2, validates application payloads, validates the single SSE ID
   equals accepted seq, rejects an SSE ID on live frames, stages/reduces the whole
   accepted batch atomically, and commits its view/cursor together. Sparse
   cursors are legal; repeated individual change IDs do not exist. Live events
   do not overwrite durable state/checkpoints. Reconnect replays from last
   committed accepted boundary; reload uses actual accepted projection cuts.
   Server/browser user-facing contracts must disclose potentially lost raw
   reasoning/progress after reconnect/crash and recovery from accepted
   summaries/final results, not promise full raw-stream replay parity.
   Apply message/draft replacements in the correct root/branch view without a
   duplicate synthetic turn. Apply exact task descriptors without treating a
   stop request or child terminal as task completion; preserve optionality.
   Upsert accepted tool_called by real execution identity, with no inferred
   physical start. Render live error connection-locally; a separate live
   turn_failed may settle only transient visible lifecycle state. Neither
   checkpoints nor creates durable terminal/history/result from live evidence.
4. Browser/BFF/API/config callers migrate together: preserve caller mutation
   key/revision/patch, allow the real selection request, handle pending and
   native typed outcomes, and separate original receipt from current discovery.
   Updating a package constant, format query or success parser alone is not this
   migration. Preserve safe diagnostics and installed/profile intent semantics.
5. Coordinate all supported hosts, browser clients, BFFs, and other consumers
   explicitly; changing one client does not migrate the others. Retained v1
   wire importers and interaction callers need compatibility/removal ownership;
   v1 data parsing support is not permission to run a legacy engine fallback.
6. Keep canonical stream/configuration gates honest until producers, artifact
   and supported consumers are coherently combined and independently verified.
   This source implementation does not activate routes or prove that condition.

## Consumer acceptance evidence

Version rejection/v1 compatibility; atomic multi-message boundary and sparse
cursor reconnect; exact aggregate arrays/rotation without lost preserved state;
real accepted compaction payload optionality/crash correlation/no extra charge;
live frame non-durability, the explicit raw reasoning/progress replay exception
and recovery from actual accepted summaries/final results; configure
pending/success/rejected/interrupted/nonreceipt errors, original outcomes across
later mutations, stable-key replay/conflict/stale/busy and discovery separation.
Also establish accepted-only evidence retention, rejection of branch-wrapped
cost/request receipts, same-request corrections without duplicate accounting,
null/absent/empty/zero preservation and real root/branch hydration without
invented aggregates or historical state. Verify actual provider continuation
through real provider paths, including complete required reasoning items,
signatures/encrypted metadata and tool call/result round trips across supported
reconnect/crash recovery. Public summary replay is not that evidence.
Also establish accepted message/task retention after hydration and on replay,
exact payload-key rejection, optional fields/empty content/false/zero retention,
real message branch ownership and draft replacement, root task scope and nested
result counts without inferred completion. Separate content/origin/error
application validation from the shared parser's bounded validation.
Establish type/parser exclusion of accepted error, live tool_called rejection,
exact tool/error payloads and optional JSON/null/false/zero retention. Exercise
real accepted call -> physical start/result identity and synchronized live
error/failure display without cursor/checkpoint or durable-terminal mutation.
Run package build/typecheck/tests/tarball/public-import checks and the real
migrated server/browser workflow, including failure/reconnect paths. Package
validation alone does not establish that application-level acceptance.

## Rollback and storage

V2 envelopes change transport interpretation, not native Session storage format.
Their actual sequences must still refer to the sole accepted native log. Do not
create a second replay journal or edit/drop accepted facts to satisfy old parsers.
Old v1 readers cannot parse v2 and may also lack new native log vocabulary; source
rollback alone is not a persistence rollback. Retain compatible readers for logs
already written. Negotiate formats per compatible consumers; do not auto-downgrade
an incompatible active session, reconstruct old IDs or enable legacy execution.
No rollback/reopen/consumer compatibility exercise has been performed here.
