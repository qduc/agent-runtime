/** Compaction proposal and summary lifecycle; TurnModel retains root request recovery. */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Item, ItemId, Model, ModelError, ModelEvent, ModelRequest, Usage } from '../model/index.js';
import type { DirectCompactionResult, DirectCompactionRequest } from './recovery-compaction.js';
import { compactDirectHistory } from './recovery-compaction.js';
import { estimateDirectContext } from './context-estimate.js';
import type { TurnCompactionEvent, TurnDeps, TurnSpec } from './types.js';
import { NativeBudgetExhausted, serviceTierForRequest, type TurnBudgetControl } from './turn-budget.js';
import { recoveryDelay } from './recovery.js';
import { TurnEvents, cancelled } from './turn-events.js';
import { turnText, type TurnNoticeSource } from './host-text.js';

type Done = Extract<ModelEvent, { type: 'done' }>;
export class CompactionWrapUp extends Error {}
/** Blocked automatic outcomes reported through `TurnDeps.warn`; hard-fit refusals fail the turn instead. */
const LOGGED_BLOCKS: ReadonlySet<string> = new Set([
  'no_complete_cold_turn',
  'opaque_context',
  'summary_input_too_large',
  'non_reducing',
]);

class CompactionHardFit extends Error {}
export type CompactionAttemptResult = DirectCompactionResult | { readonly kind: 'unavailable' | 'wrap_up' | 'failed' };

/** Owns private summary work and accepts only a durable history replacement. */
export class TurnCompaction<AppCtx = unknown> {
  #state: TurnSpec['compactionState'];
  #lastInputTokens: number | undefined;
  #noticeOrdinal = 0;
  /** A run is told once that local compaction cannot shorten its history yet. */
  #coldTurnNoticed = false;

  constructor(
    readonly spec: TurnSpec,
    readonly deps: TurnDeps<AppCtx>,
    readonly signal: AbortSignal,
    readonly events: TurnEvents,
    readonly budget: TurnBudgetControl<AppCtx>,
    readonly prepareAuxiliary: (
      request: ModelRequest,
      history: Item[],
      preparedInstructions: string,
    ) => Promise<{ request: ModelRequest; modelStep: number }>,
    readonly acceptedReplacement: () => void,
  ) {
    this.#state = spec.compactionState;
  }

  /** Admit each host context-milestone reminder as a notice item before the request. */
  async milestones(history: Item[]): Promise<boolean> {
    const reminders = this.deps.contextMilestones?.observe(this.#lastInputTokens) ?? [];
    for (const reminder of reminders) await this.#notice(history, reminder, 'context_milestone');
    return reminders.length > 0;
  }

  async #notice(history: Item[], text: string, source: TurnNoticeSource): Promise<void> {
    const item: Item = {
      type: 'summary',
      id: `${this.spec.turnId}:notice:${++this.#noticeOrdinal}` as ItemId,
      text: turnText(this.deps.text, 'notice')(text, source),
      replaces: [],
    };
    await this.events.publish({ type: 'item', item });
    history.push(item);
  }

  /** A reminder defers compaction while the measured request still fits the catalog window. */
  canDefer(request: ModelRequest): boolean {
    const contextWindow = this.deps.models.resolve(request.model).catalogContextWindow;
    if (contextWindow === undefined) return false;
    const estimate = estimateDirectContext(request, contextWindow, this.deps.compaction?.estimator);
    return (
      estimate.hardFitTokens + Math.max(0, (this.#lastInputTokens ?? 0) - estimate.renderedInputTokens) <= contextWindow
    );
  }

  /** The turn ended: hand its last completed input tokens to the next turn's reminders. */
  settleMilestones(): void {
    this.deps.contextMilestones?.settle(this.#lastInputTokens);
  }

  recordInputTokens(inputTokens: number | undefined): void {
    this.#lastInputTokens = inputTokens;
  }

  async compact(request: ModelRequest, history: Item[], manual = false): Promise<CompactionAttemptResult> {
    if (!this.deps.compaction) return { kind: 'unavailable' };
    const sourceLength = history.length;
    let attempt: { compactionId: string; started: number; accepted: boolean } | undefined;
    let outcomeChosen = false;
    const requests: DirectCompactionRequest[] = [];
    const failed = async (
      failure: Extract<TurnCompactionEvent, { type: 'compaction_failed' }>['failure'],
    ): Promise<void> => {
      if (!attempt?.accepted || outcomeChosen) return;
      outcomeChosen = true;
      await this.events.publish({
        type: 'compaction_failed',
        compactionId: attempt.compactionId,
        failure,
        durationMs: performance.now() - attempt.started,
        requests,
      });
    };
    const model = this.deps.models.resolve(request.model);
    const summaryModel: Model = {
      ref: model.ref,
      contextWindow: model.contextWindow,
      stream: (summary, signal) =>
        retrySummary(
          () => this.#summary(model, summary, history, signal, request.instructions, (record) => requests.push(record)),
          this.deps.recovery?.maxTransientRetries ?? 0,
          signal,
        ),
      ...(model.compact
        ? {
            compact: (native: ModelRequest, signal: AbortSignal) =>
              retryAuxiliary(() => this.#nativeCompact(model, native, history, signal, request.instructions, requests),
                this.deps.recovery?.maxTransientRetries ?? 0,
                signal,
              ),
          }
        : {}),
    };
    try {
      const result = await compactDirectHistory({
        ...this.deps.compaction,
        contextWindow: this.deps.compaction.contextWindow ?? model.catalogContextWindow,
        assumedContextWindow: model.contextWindow,
        request,
        model: summaryModel,
        signal: this.signal,
        ...this.#state,
        lastCompletedInputTokens: this.#lastInputTokens,
        ...(this.deps.compactionHold?.rearmAt !== undefined
          ? { blockedRearmAtEstimatedTokens: this.deps.compactionHold.rearmAt }
          : {}),
        ...(manual ? { manual: true } : {}),
        ...(this.deps.isProviderCheckpoint ? { isProviderCheckpoint: this.deps.isProviderCheckpoint } : {}),
        ...(this.deps.text ? { text: this.deps.text } : {}),
        onStarted: async (evidence) => {
          const started = {
            compactionId: `compaction_${randomUUID()}`,
            started: performance.now(),
            accepted: false,
          };
          attempt = started;
          await this.events.publish(
            { type: 'compaction_started', compactionId: started.compactionId, ...evidence },
            () => {
              started.accepted = true;
            },
          );
        },
      });
      if (result.kind !== 'compacted') {
        if (result.kind === 'blocked') {
          await failed({ kind: 'blocked', reason: result.reason });
          // Fail the turn only when the history cannot fit at all; a summary that did not reduce
          // leaves the request uncompacted.
          if (!manual && (result.reason === 'single_turn_too_large' || result.reason === 'result_still_too_large'))
            throw new CompactionHardFit(turnText(this.deps.text, 'compactionHardFit')(result.reason));
          if (!manual && result.reason === 'no_complete_cold_turn' && !this.#coldTurnNoticed) {
            this.#coldTurnNoticed = true;
            await this.#notice(history, turnText(this.deps.text, 'compactionNoColdTurn')(), 'compaction');
          }
          if (!manual && result.rearmAtEstimatedTokens !== undefined && this.deps.compactionHold)
            this.deps.compactionHold.rearmAt = result.rearmAtEstimatedTokens;
          if (!manual && LOGGED_BLOCKS.has(result.reason))
            this.deps.warn?.('Local context compaction blocked; continuing with uncompacted history', {
              provider: request.model.provider,
              model: request.model.model,
              reason: result.reason,
              renderedInputTokens: result.estimate.renderedInputTokens,
              ...(result.rearmAtEstimatedTokens !== undefined
                ? { rearmAtEstimatedTokens: result.rearmAtEstimatedTokens }
                : {}),
            });
        }
        return result;
      }
      const replacement = [...result.history, ...history.slice(sourceLength)];
      await this.events.publish({
        type: 'history_replaced',
        history: replacement,
        reason: 'compaction',
        ...(attempt ? { compactionId: attempt.compactionId } : {}),
        ...(result.rearmAtEstimatedTokens === undefined
          ? {}
          : { rearmAtEstimatedTokens: result.rearmAtEstimatedTokens }),
        ...(result.rearmAtRenderedTokens === undefined ? {} : { rearmAtRenderedTokens: result.rearmAtRenderedTokens }),
        checkpointReceipts: result.checkpointReceipts,
      });
      history.splice(0, history.length, ...replacement);
      this.#state = {
        ...(result.rearmAtEstimatedTokens === undefined
          ? {}
          : { rearmAtEstimatedTokens: result.rearmAtEstimatedTokens }),
        ...(result.rearmAtRenderedTokens === undefined ? {} : { rearmAtRenderedTokens: result.rearmAtRenderedTokens }),
        checkpointReceipts: result.checkpointReceipts,
      };
      this.#lastInputTokens = undefined;
      if (this.deps.compactionHold) this.deps.compactionHold.rearmAt = undefined;
      this.acceptedReplacement();
      if (attempt?.accepted) {
        outcomeChosen = true;
        await this.events.publish({
          type: 'compaction_completed',
          compactionId: attempt.compactionId,
          strategy: result.strategy,
          after: estimateDirectContext(
            { ...request, input: replacement },
            this.deps.compaction.contextWindow ?? model.catalogContextWindow,
            this.deps.compaction.estimator,
          ),
          durationMs: performance.now() - attempt.started,
          requests,
        });
      }
      return result;
    } catch (error) {
      await failed(
        this.signal.aborted
          ? { kind: 'cancelled' }
          : error instanceof CompactionWrapUp
          ? { kind: 'interrupted', reason: 'budget_wrap_up' }
          : error instanceof NativeBudgetExhausted
          ? { kind: 'interrupted', reason: 'budget_exhausted' }
          : { kind: 'failed', error: toModelError(error) },
      );
      if (error instanceof CompactionWrapUp) return { kind: 'wrap_up' };
      // A failed automatic attempt is logged, holds off further attempts and continues with the full context.
      // Cancellation, budgets, a hard-fit refusal and a provider context overflow still end the turn.
      if (
        manual ||
        this.signal.aborted ||
        error instanceof NativeBudgetExhausted ||
        error instanceof CompactionHardFit ||
        toModelError(error).kind === 'context_overflow'
      )
        throw error;
      if (this.deps.compactionHold) {
        const contextWindow = this.deps.compaction.contextWindow ?? model.catalogContextWindow;
        const ceiling = this.deps.compaction.maxRequestInputTokens ?? contextWindow ?? 64_000;
        this.deps.compactionHold.rearmAt =
          estimateDirectContext(request, contextWindow, this.deps.compaction?.estimator).renderedInputTokens + Math.max(1_000, Math.ceil(ceiling * 0.1));
      }
      this.deps.warn?.('Automatic local context compaction failed; continuing with uncompacted history', {
        provider: request.model.provider,
        model: request.model.model,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'failed' };
    }
  }

  /** One native compaction call (the provider's own compact endpoint), recorded like a summary request. */
  async #nativeCompact(
    model: Model,
    native: ModelRequest,
    history: Item[],
    signal: AbortSignal,
    preparedInstructions: string,
    requests: DirectCompactionRequest[],
  ): Promise<readonly Item[]> {
    const { request: prepared, modelStep } = await this.prepareAuxiliary(native, history, preparedInstructions);
    this.budget.dispatched();
    let outcome: DirectCompactionRequest['outcome'] = 'failed';
    try {
      const items = await model.compact!(prepared, signal, () => {
        this.deps.onTurnBoundary?.({ turnId: this.spec.turnId, kind: 'request_dispatched' });
      });
      await this.events.publish({ type: 'model_response_completed', modelStep, stopReason: 'end_turn' });
      outcome = 'completed';
      return items;
    } finally {
      const record: DirectCompactionRequest = {
        requestId: `${this.spec.turnId}:model:${modelStep}`,
        modelStep,
        model: prepared.model,
        outcome: signal.aborted ? 'cancelled' : outcome,
      };
      requests.push(record);
      await this.budget.record({ ...record, serviceTier: serviceTierForRequest(prepared) });
    }
  }

  async *#summary(
    model: Model,
    request: ModelRequest,
    history: Item[],
    signal: AbortSignal,
    preparedInstructions: string,
    onRequest: (record: DirectCompactionRequest) => void,
  ): AsyncGenerator<ModelEvent> {
    const prepared = await this.prepareAuxiliary(request, history, preparedInstructions);
    const requestId = `${this.spec.turnId}:model:${prepared.modelStep}`;
    let usage: Usage | undefined;
    let done: Done | undefined;
    let outcome: 'completed' | 'failed' | 'cancelled' = 'failed';
    this.budget.dispatched();
    try {
      for await (const event of model.stream(prepared.request, signal, () => {
        this.deps.onTurnBoundary?.({ turnId: this.spec.turnId, kind: 'request_dispatched' });
      })) {
        if (signal.aborted) throw cancelled();
        if (event.type === 'usage') {
          usage = event.usage;
          await this.events.publish({ type: 'usage', usage, modelStep: prepared.modelStep });
        }
        if (event.type === 'done') {
          done = event;
          await this.events.publish({
            type: 'model_response_completed',
            modelStep: prepared.modelStep,
            stopReason: event.stopReason,
            ...(event.continuation !== undefined ? { continuation: event.continuation } : {}),
            ...(event.providerMetadata !== undefined ? { providerMetadata: event.providerMetadata } : {}),
            ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
          });
          outcome = 'completed';
        }
        yield event;
      }
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      const record: DirectCompactionRequest = {
        requestId,
        modelStep: prepared.modelStep,
        model: prepared.request.model,
        // Preserve optional billable cache dimensions too; an aggregator's upstream provider
        // is display data, not part of the compaction record.
        ...(usage !== undefined
          ? {
              usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cachedInputTokens: usage.cachedInputTokens,
                ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
                ...(usage.cacheWrite1hTokens !== undefined ? { cacheWrite1hTokens: usage.cacheWrite1hTokens } : {}),
              },
            }
          : {}),
        ...(done?.costUsd !== undefined ? { costUsd: done.costUsd } : {}),
        outcome: signal.aborted ? 'cancelled' : outcome,
      };
      onRequest(record);
      await this.budget.record({
        ...record,
        serviceTier: serviceTierForRequest(prepared.request),
      });
    }
  }
}

/**
 * A summary request runs like any model run, so a retryable failure is retried up to maxTransientRetries
 * with backoff, even after part of the response arrived. The summary is private text, so it is held until the
 * request completes and a retry never repeats any of it. These are the only retries an auxiliary request
 * gets: manual compaction does not add turn-level recovery on top (TurnModel.compact), so a request that
 * keeps failing reaches the provider maxTransientRetries + 1 times and its own error is what the user sees.
 */
async function* retrySummary(
  attempt: () => AsyncGenerator<ModelEvent>,
  maxRetries: number,
  signal: AbortSignal,
): AsyncGenerator<ModelEvent> {
  for (let retry = 1; ; retry++) {
    const events: ModelEvent[] = [];
    try {
      for await (const event of attempt()) events.push(event);
      yield* events;
      return;
    } catch (error) {
      await auxiliaryBackoff(error, retry, maxRetries, signal);
    }
  }
}

/** The native-compaction counterpart of {@link retrySummary}: the same retry rule for a single call. */
async function retryAuxiliary<T>(attempt: () => Promise<T>, maxRetries: number, signal: AbortSignal): Promise<T> {
  for (let retry = 1; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      await auxiliaryBackoff(error, retry, maxRetries, signal);
    }
  }
}

/** Rethrows unless `error` is a transient or interrupted failure with retries left; otherwise waits its backoff. */
async function auxiliaryBackoff(error: unknown, retry: number, maxRetries: number, signal: AbortSignal): Promise<void> {
  const failure = toModelError(error);
  const interrupted =
    (error as { recoveryEvidence?: unknown } | null)?.recoveryEvidence === 'connection_interrupted';
  const transient = failure.retryable && ['network', 'rate_limit', 'provider'].includes(failure.kind);
  if (signal.aborted || retry > maxRetries || !(transient || interrupted)) throw error;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, recoveryDelay(retry, failure.retryAfterMs));
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(cancelled())), { once: true });
  });
}

function toModelError(error: unknown): ModelError {
  const { kind, message, retryable, retryAfterMs } = (error ?? {}) as Partial<ModelError>;
  if (typeof kind === 'string' && typeof message === 'string')
    return {
      kind,
      message,
      retryable: retryable === true,
      ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
    };
  return {
    kind: 'provider',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
