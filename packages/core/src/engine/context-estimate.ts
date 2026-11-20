/**
 * Context-size estimates. The engine never tokenizes: a `ContextEstimator` turns a request (or a slice of
 * history) into estimated input tokens. These numbers drive the automatic compaction triggers, the
 * input-limit admission check and local compaction's hot-tail cut, and they are reported in compaction
 * events. A host that already shows users its own estimate supplies `TurnDeps.compaction.estimator` so both
 * agree; otherwise `defaultContextEstimator` counts ceil(bytes / 4) of the request's JSON.
 */
import type { Item, ModelRequest } from '../model/index.js';

export type DirectContextEstimate = {
  readonly renderedInputTokens: number;
  readonly outputReserveTokens: number;
  readonly safetyReserveTokens: number;
  readonly hardFitTokens: number;
};

export type ContextEstimator = {
  /** Estimated input tokens of a whole request: instructions, tool declarations and history. */
  requestTokens(request: Pick<ModelRequest, 'instructions' | 'tools' | 'input'>): number;
  /** Estimated tokens of a history slice alone, used to size the protected tail of local compaction. */
  historyTokens(history: readonly Item[]): number;
};

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '');

/** ceil(bytes / 4) of the portable request JSON. */
export const defaultContextEstimator: ContextEstimator = {
  requestTokens: (request) =>
    Math.ceil(
      jsonBytes({ instructions: request.instructions ?? '', tools: request.tools ?? [], input: request.input }) / 4,
    ),
  historyTokens: (history) => Math.ceil(jsonBytes(history) / 4),
};

/** Conservative estimate with a 10% capacity reserve. Never changes history. */
export function estimateDirectContext(
  request: ModelRequest,
  contextWindow?: number,
  estimator: ContextEstimator = defaultContextEstimator,
): DirectContextEstimate {
  const renderedInputTokens = estimator.requestTokens(request);
  const outputReserveTokens = Math.max(0, Math.ceil(request.maxOutputTokens ?? 0));
  const safetyReserveTokens = Math.ceil((contextWindow ?? 0) * 0.1);
  return {
    renderedInputTokens,
    outputReserveTokens,
    safetyReserveTokens,
    hardFitTokens: renderedInputTokens + outputReserveTokens + safetyReserveTokens,
  };
}
