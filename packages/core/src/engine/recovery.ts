/** Recovery admission only: the direct engine remains the sole request driver. */
import type { ModelError } from '../model/index.js';
import { RetryRecoveryBudget, type RetryRecoveryAdmission } from '../model/failure/retry-recovery-budget.js';
import { AmbiguousModelOutcomeError, getZeroFrameAmbiguousTimeout } from '../model/failure/retry-errors.js';

export { RetryRecoveryBudget };
export type { RetryRecoveryAdmission };

/** Evidence must come from the model adapter, not message/timeout wording. */
export type DirectRecoveryFailure = {
  readonly error: ModelError;
  readonly cause?: unknown;
  readonly evidence?:
    | 'request_unsent'
    | 'provider_state_rejected'
    | 'connection_interrupted'
    | 'ambiguous_outcome'
    | 'model_behavior'
    | 'service_tier_rejected'
    | 'transport_downgrade';
};

export type DirectRecoveryContext = {
  readonly failure: DirectRecoveryFailure;
  readonly cancelled: boolean;
  /** False if the local transcript cannot form a self-contained request. */
  readonly fullHistoryAvailable: boolean;
  /** Retained caller policy input; physical request retries are not fresh starts. */
  readonly freshStartAllowed: boolean;
  /** Any accepted model output/effect in this logical turn (not bookkeeping). */
  readonly hasCommittedOutput: boolean;
  /**
   * Output from this failed physical request only. Absent retains the older
   * conservative logical-turn gate; false permits retry after accepted prior
   * responses only when completed tool pairs remain in full history.
   */
  readonly hasCurrentRequestOutput?: boolean;
  /** The failed request's output is text only, which a retry may withdraw. */
  readonly withdrawableOutput?: boolean;
  readonly tools: {
    readonly completed: number;
    readonly allCompleted: boolean;
    readonly completedPairsInHistory: boolean;
  };
};

export type DirectRecoveryDecision =
  | {
      readonly kind: 'stop';
      readonly reason:
        | 'cancelled'
        | 'unrecoverable'
        | 'history_unavailable'
        | 'unsettled_tools'
        | 'committed_output'
        | 'fresh_start_forbidden'
        | 'retry_limit'
        | 'recovery_budget';
      readonly admission?: RetryRecoveryAdmission;
      /** The attempt count the exhausted-retries notice reports once transient retries are used up. */
      readonly exhaustedAfter?: number;
    }
  | {
      readonly kind: 'retry';
      readonly recovery: 'transient' | 'chain' | 'model_behavior' | 'service_tier' | 'transport';
      readonly attempt: number;
      /** This recovery kind's retry limit. */
      readonly maxRetries: number;
      readonly delayMs: number;
      readonly inputMode: 'full_history' | 'delta';
      readonly disableChaining: boolean;
      readonly useStandardServiceTier: boolean;
      readonly downgradeTransport: boolean;
      readonly automaticReplay: boolean;
      /** The next dispatch is already charged; adapters must not charge it twice. */
      readonly dispatchClaimed: true;
      readonly admission: RetryRecoveryAdmission;
      readonly notice?: DirectRetryNotice;
      /** Withdraw the failed request's partial text before retrying. */
      readonly withdraw?: true;
    };

/** A retry the user is told about ("retrying k/N in Ns"). */
export type DirectRetryNotice = {
  readonly attempt: number;
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly retryType: 'upstream' | 'connection_interrupted';
};

type RecoveryKind = Extract<DirectRecoveryDecision, { kind: 'retry' }>['recovery'];
type RecoveryChoice =
  | { kind: 'transient'; automaticReplay: false }
  | { kind: Exclude<RecoveryKind, 'transient'>; automaticReplay: boolean };

export type DirectRecoveryOptions = {
  readonly maxTransientRetries: number;
  readonly maxModelRetries?: number;
  readonly budget?: RetryRecoveryBudget;
  readonly random?: () => number;
};

/**
 * One instance per logical run, shared across tool-loop model requests. Only an
 * accepted terminal model response ends the recovery-budget episode. No timer
 * aborts healthy work: the 90s budget measures recovery overhead, not run time.
 * `recover` reserves the next physical dispatch; call once per failed request.
 */
export class DirectRecovery {
  readonly budget: RetryRecoveryBudget;
  readonly #options: DirectRecoveryOptions;
  #transientRetries = 0;
  #silentRetries = 0;
  #modelRetries = 0;
  #tierFallbacks = 0;
  #transportDowngrades = 0;

  constructor(options: DirectRecoveryOptions) {
    assertRetryCount(options.maxTransientRetries);
    assertRetryCount(options.maxModelRetries ?? 2);
    this.#options = options;
    // The default budget never refuses a retry the caller asked for: its attempt cap grows to
    // maxTransientRetries, and the recovery clock still bounds the episode.
    const fallback = new RetryRecoveryBudget();
    this.budget =
      options.budget ??
      (options.maxTransientRetries > fallback.maxPhysicalAttempts
        ? new RetryRecoveryBudget({ maxPhysicalAttempts: options.maxTransientRetries })
        : fallback);
  }

  /** Call after Session has accepted the complete model response, never on a delta. */
  responseAccepted(): void {
    this.budget.noteModelResponseCompleted();
    this.#transientRetries = 0;
    this.#silentRetries = 0;
    this.#modelRetries = 0;
  }

  /** Classify and reserve recovery; does not edit history or re-invoke a tool. */
  recover(context: DirectRecoveryContext): DirectRecoveryDecision {
    if (context.cancelled || context.failure.error.kind === 'cancelled') return stop('cancelled');
    if (!context.fullHistoryAvailable) return stop('history_unavailable');
    if (!context.tools.allCompleted) return stop('unsettled_tools');
    const interrupted = context.failure.evidence === 'connection_interrupted';
    const output = context.hasCurrentRequestOutput ?? context.hasCommittedOutput;
    // A stream cut before any output is the same request failing again: it shares the transient schedule,
    // counter and notices, so mixed failure modes still send at most maxTransientRetries + 1 requests.
    if (interrupted && !output) return this.#transient(context, 'connection_interrupted');
    // Partial text from a cut stream is rolled back silently and the request retried from full history,
    // up to maxTransientRetries times. The turn-level retry refuses once output was committed.
    if (interrupted && context.withdrawableOutput && this.#silentRetries < this.#options.maxTransientRetries) {
      const attempt = ++this.#silentRetries;
      const max = this.#options.maxTransientRetries;
      const delayMs = recoveryDelay(attempt, undefined, this.#options.random);
      const admission = this.budget.describeAdmission({ automaticReplayRequired: false });
      return { ...transientRetry(attempt, max, delayMs, admission), recovery: 'chain', withdraw: true };
    }
    if (interrupted && context.withdrawableOutput) return stop('committed_output');
    if (interrupted) this.#silentRetries = 0;
    const choice = chooseRecovery(context);
    if (!choice) return stop(context.hasCommittedOutput ? 'committed_output' : 'unrecoverable');
    if (choice.kind === 'transient') return this.#transient(context);
    if (!this.#withinLimit(choice.kind)) return stop('retry_limit');

    this.budget.noteRetryableFailure();
    const options = { automaticReplayRequired: choice.automaticReplay };
    const admission =
      this.budget.claimZeroFrameTimeoutRecovery(context.failure.cause, {
        ...options,
        maxRetries: this.#options.maxTransientRetries,
      }) ?? this.budget.describeAdmission(options);
    if (!admission.admitted) return { ...stop('recovery_budget'), admission };
    // The typed zero-frame path atomically claimed both counters already.
    if (!getZeroFrameAmbiguousTimeout(context.failure.cause)) {
      if (choice.automaticReplay) this.budget.claimAutomaticReplay();
      this.budget.claimPhysicalAttempt();
    }
    const attempt = this.#advance(choice.kind);
    const delayMs = recoveryDelay(attempt, context.failure.error.retryAfterMs, this.#options.random);
    const notice =
      interrupted && choice.kind === 'chain'
        ? {
            notice: {
              attempt,
              maxRetries: this.#options.maxTransientRetries,
              delayMs,
              retryType: 'connection_interrupted' as const,
            },
          }
        : {};
    return {
      ...notice,
      kind: 'retry',
      recovery: choice.kind,
      attempt,
      maxRetries: this.#limit(choice.kind),
      delayMs,
      inputMode: choice.kind === 'service_tier' ? 'delta' : 'full_history',
      disableChaining: choice.kind !== 'service_tier',
      useStandardServiceTier: choice.kind === 'service_tier',
      downgradeTransport: choice.kind === 'transport',
      automaticReplay: choice.automaticReplay,
      dispatchClaimed: true,
      admission,
    };
  }

  /**
   * The schedule for a request that failed before any output: at most maxTransientRetries retries in the
   * episode, each announced with a "retrying k/N" notice, so a request that keeps failing reaches the
   * provider maxTransientRetries + 1 times. Each retry rebuilds the same request from accepted history; it
   * is not a whole-turn replay (see chooseRecovery), so it spends a physical attempt but not the
   * automatic-replay claim. exhaustedAfter counts the requests already sent.
   */
  #transient(
    context: DirectRecoveryContext,
    retryType: DirectRetryNotice['retryType'] = 'upstream',
  ): DirectRecoveryDecision {
    const max = this.#options.maxTransientRetries;
    const attempt = this.#transientRetries + 1;
    if (attempt > max) return { ...stop('retry_limit'), exhaustedAfter: attempt };
    this.budget.noteRetryableFailure();
    const delayMs = recoveryDelay(attempt, context.failure.error.retryAfterMs, this.#options.random);
    const admission = this.budget.describeAdmission({ automaticReplayRequired: false });
    // A retry whose wait would outlast the recovery clock is never announced or sent: the turn settles
    // now with the requests actually made, rather than promising a retry the clock then forbids.
    const remainingMs = this.budget.remainingMs();
    if ((remainingMs !== undefined && delayMs >= remainingMs) || !this.budget.claimPhysicalAttempt())
      return { ...stop('recovery_budget'), admission, exhaustedAfter: attempt };
    this.#transientRetries = attempt;
    const notice = { attempt, maxRetries: max, delayMs, retryType };
    const retry = transientRetry(attempt, max, delayMs, admission);
    return retryType === 'upstream' ? { ...retry, notice } : { ...retry, recovery: 'chain', notice };
  }

  #withinLimit(kind: RecoveryKind): boolean {
    const used =
      kind === 'model_behavior'
        ? this.#modelRetries
        : kind === 'service_tier'
        ? this.#tierFallbacks
        : kind === 'transport'
        ? this.#transportDowngrades
        : this.#transientRetries;
    return used < this.#limit(kind);
  }

  #limit(kind: RecoveryKind): number {
    if (kind === 'model_behavior') return this.#options.maxModelRetries ?? 2;
    if (kind === 'service_tier' || kind === 'transport') return 1;
    return this.#options.maxTransientRetries;
  }

  #advance(kind: RecoveryKind): number {
    if (kind === 'model_behavior') return ++this.#modelRetries;
    if (kind === 'service_tier') return ++this.#tierFallbacks;
    if (kind === 'transport') return ++this.#transportDowngrades;
    return ++this.#transientRetries;
  }
}

function transientRetry(
  attempt: number,
  maxRetries: number,
  delayMs: number,
  admission: RetryRecoveryAdmission,
): Extract<DirectRecoveryDecision, { kind: 'retry' }> {
  return {
    kind: 'retry',
    recovery: 'transient',
    attempt,
    maxRetries,
    delayMs,
    inputMode: 'full_history',
    disableChaining: true,
    useStandardServiceTier: false,
    downgradeTransport: false,
    automaticReplay: false,
    dispatchClaimed: true,
    admission,
  };
}

/** A turn that ran out of transient retries, with the host's `retriesExhausted` notice. */
export class RetriesExhausted extends Error {
  constructor(readonly failure: unknown, readonly notice: string) {
    super(failure instanceof Error ? failure.message : String(failure));
  }
}

function chooseRecovery(context: DirectRecoveryContext): RecoveryChoice | undefined {
  const { failure, tools } = context;
  const evidence = failure.evidence;
  const zeroFrame = !!getZeroFrameAmbiguousTimeout(failure.cause);
  // A refused provider-state request may be rebuilt once completed pairs have
  // been reconciled from Session's ledger, even across a compaction boundary.
  const settledContinuation =
    tools.completed > 0 && (tools.completedPairsInHistory || evidence === 'provider_state_rejected');
  const chainFailure =
    evidence === 'request_unsent' ||
    evidence === 'provider_state_rejected' ||
    evidence === 'connection_interrupted' ||
    zeroFrame;
  const currentRequestOutput = context.hasCurrentRequestOutput ?? context.hasCommittedOutput;
  const ambiguous = evidence === 'ambiguous_outcome' || failure.cause instanceof AmbiguousModelOutcomeError;
  const ordinaryTransport =
    !evidence &&
    !ambiguous &&
    failure.error.retryable &&
    ['network', 'rate_limit', 'provider'].includes(failure.error.kind);
  if (ordinaryTransport && !currentRequestOutput && (tools.completed === 0 || tools.completedPairsInHistory)) {
    // Engine-owned pre-output transport retries replace the adapter's former
    // hidden retry loop. Prior accepted responses stay in full history; all
    // physical tools are settled and their pairs retained, never re-executed.
    // Neither rebuilding that request nor freshStartAllowed:false turns this
    // physical dispatch into a whole-turn replay. Keep its replay claim free.
    return { kind: 'transient', automaticReplay: false };
  }
  if (context.hasCommittedOutput || currentRequestOutput) {
    return settledContinuation && chainFailure ? { kind: 'chain', automaticReplay: false } : undefined;
  }
  if (ambiguous && !zeroFrame) return undefined;
  if (chainFailure) return { kind: 'chain', automaticReplay: !settledContinuation };
  if (evidence === 'model_behavior') return { kind: 'model_behavior', automaticReplay: true };
  if (evidence === 'service_tier_rejected') return { kind: 'service_tier', automaticReplay: false };
  if (evidence === 'transport_downgrade') return { kind: 'transport', automaticReplay: true };
  return undefined;
}

/** Preserve upstream Retry-After; otherwise use the existing 500ms..30s jittered backoff. */
export function recoveryDelay(attempt: number, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  return Math.round(Math.min(500 * 2 ** Math.max(0, attempt - 1), 30_000) * (0.9 + random() * 0.2));
}

function stop(
  reason: Extract<DirectRecoveryDecision, { kind: 'stop' }>['reason'],
): Extract<DirectRecoveryDecision, { kind: 'stop' }> {
  return { kind: 'stop', reason };
}

function assertRetryCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Retry count must be a nonnegative integer');
}
