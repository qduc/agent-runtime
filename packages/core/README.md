# Agent harness core

A portable, application-owned turn loop (first used by Term2). Hosts own history,
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

A tool with `standalone: true` is a control tool: if a model response contains it
together with other calls it gets an error result instead of running, and
`ToolContext.executeChild` refuses it, so only a root call can invoke it. The
engine reads the flag from the registry that resolved the call; it knows no tool
names of its own.

## Model identity

`ModelRequest.affinity` and `TurnSpec.affinity` carry provider identity explicitly:
`conversationKey` selects logical history, `cacheKey` selects prefix-cache affinity,
and optional `routingKey` selects the sticky server or transport (defaulting to the
cache key, then conversation key). History can rotate while cache/routing keys stay
stable. Hosts give nested and advisory requests their own identity; `startNestedTurn`
accepts affinity with its turn ID. The engine carries it through retries and both
local and native compaction. The fields are host inputs, not history or events.

Model `provider_status` events (`{ provider, status }`) carry provider account or
service state such as rate-limit windows or quota. `status` is an adapter-defined
record; the turn engine forwards the event to the host unchanged as a live-only
`TurnEvent`.

## Host seams

| Seam | Contract |
| --- | --- |
| `prepareRequest` | Before every model dispatch, receives the request plus turn ID, model step, and signal. Returns the live request and optional tool registry. Stored history stays unchanged. |
| `takeSteering` and `handle.steer()` | Admit new user items at the next request boundary; do not interrupt a response in flight. |
| `interaction_required` and `handle.answer()` | Approval or question waits for the matching answer. An unanswered request waits until cancellation; hosts own timeout policy. |
| `normalStop` | After a model response without tool calls, stop or continue with a reminder. A stop with a host-defined `terminalCause` string ends the turn `interrupted` with that cause. |
| `text` | Host wording (`TurnText`): notice items (`notice(text, source)`), the exhausted-retries notice, compaction hard-fit and no-cold-turn messages, request-input-limit refusals. Each hook falls back to `defaultTurnText`. |
| `isProviderCheckpoint` | Marks a provider-native compaction item: requests start from the newest one and local compaction will not summarize it. Without it only `summary` items with `replaces` cut the request prefix. |
| `runNested` | Host assigns child identity and lifetime, runs the same loop, and returns its result. The host routes child interactions. |
| Event acceptance | Every emitted receipt is acknowledged only after the host durably accepts its event. |

A throwing request/steering/stop seam ends the turn; a slow seam delays progress.
Cancellation reaches seam implementations through their supplied signals.
`onTurnBoundary` observes dispatch, parking, cancellation, and termination.

## Opt-in helpers

Compaction remains inside the driver for now. `startCompaction` runs only the
compaction path; history replacements take effect after host acceptance. Budget
policy and continuity are optional. A host can supply `accounting` pricing and
subscription callbacks; without them, actual provider charges are retained and
unknown rates stay unpriced. No provider catalog or host settings are loaded.

`TurnDeps.compaction` also takes optional hooks (`DirectCompactionHooks`):
`estimator` (a `ContextEstimator`; default `defaultContextEstimator`, ceil(bytes/4)
of the request JSON) drives the triggers, admission check, hot-tail cut and the
estimates in compaction events; `prompts` (`CompactionPrompts`; default
`defaultCompactionPrompts`) supplies the summary requests and checkpoint wrapper;
`isHostMessage` marks host-written user messages that local compaction may
summarize instead of protecting verbatim; `receiptArguments` previews a call's
arguments in its tool receipt line.

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
own tool-name policy. The public continuity, tool-pair repair check, context
policy, budget, and cost helpers are host building blocks. Shared `ModelFailure` and retry error/budget
constructors let adapters supply live recovery evidence without losing class
identity across the package boundary. Engine driver classes and compaction
implementation helpers remain private.

### Migrating to 0.3

0.3 removes host-specific behaviour from the engine; a host that relied on it
supplies it through the seams above.

- `codex_quota` model and turn events became `provider_status`; `CodexWeeklyQuota`
  is gone. Emit `{ type: 'provider_status', provider, status }` from the adapter
  and read your own shape from `status`.
- The engine no longer treats `goal_check` and `session_rollover` as control tools;
  set `standalone: true` on such tools.
- Notice items no longer get a `[Mode Notice] ` prefix; add one with `text.notice`.
  Failure texts no longer mention slash commands or settings keys; restore yours
  with the other `text` hooks.
- The context estimate is now bytes/4 of the portable request JSON. To keep a
  different estimate (for example your own request shape) supply `compaction.estimator`.
- Local compaction protects every user message unless `compaction.isHostMessage`
  says the host wrote it; the built-in background-notice prefixes are gone.
- OpenAI `compaction` items no longer cut the request prefix by provider name;
  supply `isProviderCheckpoint`.
- `terminalCause` on `NormalStopDecision`, `TurnResult` and `NestedRunOutcome` is
  a `string`; the `retrying` turn event no longer has `toolName` (derive it from
  `retryType` if needed).
- The default compaction request no longer mentions completion verification;
  supply `compaction.prompts` to keep custom wording.

### Retry count from 0.3.0-alpha.1

`recovery.maxTransientRetries = n` now bounds the retries of a request that fails
before any output to n in total, so a provider that keeps failing receives n + 1
requests, and each retry emits a `retrying` event numbered `k/n`. Earlier 0.3
prereleases ran n silent retries, then one numbered turn-level retry that ran the
silent ones again: 2 × (n + 1) requests for n ≥ 1. A transient retry now claims a
physical attempt from the recovery budget but not its automatic replay, and the
exhausted-retries notice counts the requests sent.

0.3.0-alpha.2 applies the same count to a stream cut before any output
(`connection_interrupted` with no output): n retries from full history, each
emitting a `retrying` event of type `connection_interrupted` numbered `k/n`, then a
stop that reports n + 1 requests. alpha.1 still followed them with a chain retry
that ran them all again. A stream cut after output is unchanged: its partial text is
withdrawn and retried silently up to n times. Without a caller-supplied `budget`,
the default recovery budget's physical-attempt cap is raised to
`maxTransientRetries` when that is larger than 3, so it no longer stops a retry the
caller asked for; the 90 s recovery clock still bounds the episode.

0.3.0-alpha.3 puts that pre-output stream cut on the same counter as a failed
request, so a provider that alternates between the two still receives n + 1
requests, with one `k/n` series of `retrying` events. A transient retry whose delay
cannot fit the remaining recovery clock is decided before anything is announced:
recovery stops with `recovery_budget` and `exhaustedAfter` set to the requests
sent, so no `retrying` event promises a request that is never made. The engine
checks every other recovery kind's delay against the clock before its notice too.
A request carrying `recovery.dispatchClaimed` was admitted against the clock
before its backoff; an adapter must send it rather than re-check the deadline,
which timer lateness can push past. With a caller-supplied `budget`, its
physical-attempt cap now also bounds retries of a stream cut before output.

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
