/**
 * Host-owned wording. The engine reports structured causes; a host that wants its own phrasing,
 * slash commands or settings names in the text a user or model reads supplies `TurnDeps.text`.
 * Every hook is optional and falls back to the neutral default below.
 */

/** Where an engine-inserted notice item comes from. */
export type TurnNoticeSource = 'normal_stop' | 'context_milestone' | 'compaction';

/** Why a prepared request was refused before dispatch. */
export type RequestInputLimitDetail =
  | {
      readonly limitSource: 'model_capacity';
      readonly inputBudget: number;
      readonly outputReserve: number;
      readonly estimationReserve: number;
      readonly capacity: number | undefined;
    }
  | { readonly limitSource: 'explicit_input_ceiling'; readonly estimated: number; readonly limit: number };

export type TurnText = {
  /** The text of a notice item the engine adds to history (normal-stop and milestone reminders, compaction notices). */
  readonly notice?: (text: string, source: TurnNoticeSource) => string;
  /** The `TurnResult.notice` of a turn that used up its transient retries without a model response. */
  readonly retriesExhausted?: (provider: string, attempts: number) => string;
  /** The failure message when compaction cannot make the history fit. */
  readonly compactionHardFit?: (reason: 'single_turn_too_large' | 'result_still_too_large') => string;
  /** The one-per-turn notice when local compaction has no completed older turn to summarize yet. */
  readonly compactionNoColdTurn?: () => string;
  /** The refusal text of a request over its input limit; the engine prefixes it with `request_input_limit: `. */
  readonly requestInputLimit?: (detail: RequestInputLimitDetail) => string;
  /** The error when manual local compaction cannot size an uncatalogued model. */
  readonly compactionThresholdRequired?: () => string;
};

export const defaultTurnText: Required<TurnText> = {
  notice: (text) => text,
  retriesExhausted: (provider, attempts) =>
    `Could not reach ${provider} after ${attempts} attempts. No model response was received.`,
  compactionHardFit: (reason) =>
    `${
      reason === 'single_turn_too_large'
        ? 'The protected recent conversation is too large to fit the configured context window'
        : 'The compacted conversation is still too large to fit the configured context window'
    }. Compaction did not reduce the existing context.`,
  compactionNoColdTurn: () =>
    'Local compaction cannot shorten this history yet: it needs an older completed turn or settled tool rounds and preserves all user requests. ' +
    'Continue the current work and keep outputs concise. Do not repeat completed work or manufacture user turns to force compaction.',
  requestInputLimit: (detail) =>
    detail.limitSource === 'model_capacity'
      ? `Request cannot fit the known model capacity (input budget ${detail.inputBudget}, output reserve ${detail.outputReserve}, estimation reserve ${detail.estimationReserve}, capacity ${detail.capacity}). Work is retained. Compact, choose a larger-capacity model, or lower an explicit output allocation before resuming.`
      : `Request input exceeds configured ceiling (${detail.estimated} > ${detail.limit} tokens). Work is retained. Compact or raise the configured input ceiling before resuming.`,
  compactionThresholdRequired: () => 'Set a token compaction threshold (compactThresholdTokens) for an uncatalogued model',
};

/** Resolve one hook against its default. */
export function turnText<K extends keyof TurnText>(text: TurnText | undefined, key: K): Required<TurnText>[K] {
  return (text?.[key] ?? defaultTurnText[key]) as Required<TurnText>[K];
}
