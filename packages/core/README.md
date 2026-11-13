# Agent harness core

The portable, application-owned turn loop used by Term2. Hosts own history,
persistence, providers, tools, and application context. This ESM package requires
Node 24 and has no runtime dependencies. Import only
`@qduc/agent-core`; implementation subpaths are not exported.

## Running a turn

`startTurn(spec, deps)` returns a `TurnHandle`. `TurnSpec` supplies history, new
items, instructions, a model reference, offered tools, and optional model/tool
call limits. `TurnDeps` supplies model/tool registries and optional host seams.
Each invocation owns its event channel, cancellation, recovery, and tool state.

Consume `handle.events`, persist each `{ event, token }`, then call
`handle.accept(token)`. The engine waits for the delivered token before
advancing; accepting queued, old, or duplicate tokens does not advance it. The
engine never writes history. `handle.cancel()` aborts physical work and drains
known cleanup outcomes. Accepted deltas may be withdrawn during recovery; hosts
must honor those withdrawals when displaying partial output.

`Tool<Input, AppCtx>` uses JSON Schema plus `parse`, `approval`, and `execute`.
No schema-library object crosses the boundary. `ToolContext<AppCtx>.app` carries
host capabilities; signal, progress, interaction, and nested execution remain
engine-owned. Supply plain `toolContext` data or `createToolContext(binding)`
for capabilities bound to the current physical execution. A factory exception
ends the turn before the tool body starts.

## Model identity

`ModelRequest.affinity` and `TurnSpec.affinity` carry provider identity explicitly:
`conversationKey` selects logical history, `cacheKey` selects prefix-cache affinity,
and optional `routingKey` selects the sticky server or transport (defaulting to the
cache key, then conversation key). History can rotate while cache/routing keys stay
stable. Hosts give nested and advisory requests their own identity; `startNestedTurn`
accepts affinity with its turn ID. The engine carries it through retries and both
local and native compaction. The fields are host inputs, not history or events.

## Host seams

| Seam | Contract |
| --- | --- |
| `prepareRequest` | Before every model dispatch, receives the request plus turn ID, model step, and signal. Returns the live request and optional tool registry. Stored history stays unchanged. |
| `takeSteering` and `handle.steer()` | Admit new user items at the next request boundary; do not interrupt a response in flight. |
| `interaction_required` and `handle.answer()` | Approval or question waits for the matching answer. An unanswered request waits until cancellation; hosts own timeout policy. |
| `normalStop` | After a model response without tool calls, stop or continue with a reminder. Also consulted early for an opted-in stop check (below), with `stopCheck` set. |
| `stopCheckTools` | Opt-in, default none. See [Stop-check tools](#stop-check-tools). |
| `runNested` | Host assigns child identity and lifetime, runs the same loop, and returns its result. The host routes child interactions. |
| Event acceptance | Every emitted receipt is acknowledged only after the host durably accepts its event. |

A throwing request/steering/stop seam ends the turn; a slow seam delays progress.
Cancellation reaches seam implementations through their supplied signals.
`onTurnBoundary` observes dispatch, parking, cancellation, and termination.

### Stop-check tools

By default a tool result is never the model's final answer: after any tool call the
engine sends another request so the model reads the result, and `normalStop` runs
only after a response without tool calls. A host whose stop policy is driven by a
self-check tool can save that request by listing the tool in `stopCheckTools`.
The engine then consults `normalStop` with `stopCheck: { toolName, callId, modelStep }`
right after the tool settles, but only when all of these hold:

- the completed response carried non-whitespace assistant text;
- that call was the response's only tool call;
- its result is the latest history item and is not `isError`;
- no steering was waiting (waiting steering is admitted and the model responds first).

`stop` ends the turn on that response, so its text is the final reply and the
call/result pair is the last history; `continue` publishes the reminder after the
result, as at a normal stop. `defer` continues exactly as if the tool were not
listed: the model reads the result and `normalStop` runs again at the next normal
stop. A deferral must therefore have no side effects. Returning `defer` without
`stopCheck` fails the turn. Hosts that do not set `stopCheckTools` see no change.
The engine checks only shape; the host's policy still owns whether the check's
result is valid for the stop. Nested turns get no `normalStop`, so no early stop.

## Opt-in helpers

Compaction remains inside the driver for now. `startCompaction` runs only the
compaction path; history replacements take effect after host acceptance. Budget
policy and continuity are optional. A host can supply `accounting` pricing and
subscription callbacks; without them, actual provider charges are retained and
unknown rates stay unpriced. No provider catalog or host settings are loaded.

### Context window: capacity versus the host's assumption

Real capacity comes from `TurnDeps.compaction.contextWindow` or, failing that,
`Model.catalogContextWindow`; when known, it sizes the compaction trigger, the
hard input limit and request admission. `Model.contextWindow` is required and
host-supplied: catalog capacity when known, otherwise the host's own assumption.
For a model without known capacity, the engine uses `Model.contextWindow` only to
schedule automatic compaction at `contextWindow × compactThreshold` (or earlier, if
`compactThresholdTokens` or `maxRequestInputTokens` trigger sooner). It is never a
capacity or admission limit: a request above it is still admitted unless the host
set `maxRequestInputTokens`. Manual compaction ignores it. The core has no default
window of its own; the number is the host's policy, and automatic compaction
rejects a non-positive or non-integer value when it would use it.

Migration: `DEFAULT_ASSUMED_CONTEXT_WINDOW` (previously `128_000`) is no longer
exported. Hosts that imported it must define their own fallback and set it as
`Model.contextWindow` for models without catalog capacity.

Local summaries set `ModelRequest.toolChoice` to `none`. Live-prefix summaries
retain their tool schemas for cache matching; chunk summaries keep an empty
tool list. Auxiliary preparation preserves these tool lists and the selection
override even when the host normally adds session tools. Provider adapters must
forward the override; an unexpected summary tool call still fails without execution.

`startNestedTurn` scopes offered tools and enforces native branch limits. Hosts
own tool-name policy; Term2 applies its root-only tool restriction in Session.
The public continuity, tool-pair repair check, context policy, budget, and cost
helpers support Term2's host modules. Shared `ModelFailure` and retry error/budget
constructors let adapters supply live recovery evidence without losing class
identity across the package boundary. Engine driver classes and compaction
implementation helpers remain private.

## Distribution and verification

Prereleases go to npm under the `next` dist-tag, so `npm install @qduc/agent-core`
without a version or tag installs nothing until a stable release exists; consumers
pin an exact prerelease version. `0.1.0` was used by an earlier, unpublished
snapshot and cannot be republished. `pnpm --filter @qduc/agent-core build` emits
JavaScript and declarations to `dist/`.

The repository's installed-tarball smoke (`scripts/agent-package-smoke.mjs`) packs
the package, installs it into a plain project and runs two concurrent turns with
distinct settings and application contexts through the public entry point, then
type-checks a consumer without `skipLibCheck`. `scripts/core-import-boundary.test.ts`
keeps the source free of imports other than Node built-ins and its own files.
Term2, the first consumer, exercises it in its integration and e2e tiers.
Watch mode uses the Node-based compiler because native fanotify watching is not
available on every workspace filesystem.

`tests/engine/agent-harness-package.integration.test.ts` compiles current package sources into an isolated staging directory, packs that
output, and installs the tarball into a separate plain JavaScript project, and runs two
concurrent turns with distinct settings and application contexts through the
public entry point. Existing Term2 integration and e2e tiers exercise the first
consumer.

## Usage and catalog cost accounting

`Usage.inputTokens` is total input including cache reads and cache writes. Optional
`cacheWriteTokens` counts cache creation; `cacheWrite1hTokens` is its one-hour TTL
subset. Existing models omitting both fields retain their previous behavior.
The engine bridges this to `NormalizedUsage.prompt_tokens` (input including reads,
excluding separately counted `cache_creation_tokens`); `total_tokens` includes each
input/output token once. Compaction request records preserve these dimensions.

`CatalogPrice.tiers` supplies whole-request rates above strictly exceeded
`inputTokensAbove` thresholds. Thresholds include all input tokens, including reads
and writes; the highest matching threshold wins. Provider-reported charges still
win over catalog estimates. One-hour writes require an explicit
`cacheWrite1hPerMTok` rate; the engine does not infer a vendor-specific TTL price.
Reported cache creation without the corresponding short/one-hour rate is
unpriced (an explicit zero rate still means free). The optional one-hour field in
`BillableTokens` is omitted when usage omits the subset, preserving legacy object
construction and return shapes. Catalog estimates retain integer-micro rounding
per billable dimension. Catalog
data, native usage normalization and consumer integration remain host-owned.
