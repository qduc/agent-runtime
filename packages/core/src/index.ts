/** Public harness contracts, turn entry points, and opt-in recovery/accounting helpers. */
export * from './engine/index.js';
export type * from './engine/types.js';
export { startNestedTurn } from './engine/turn.js';
export * from './engine/host-text.js';
export {
  defaultContextEstimator,
  estimateDirectContext,
  type ContextEstimator,
  type DirectContextEstimate,
} from './engine/context-estimate.js';
export { defaultCompactionPrompts, type CompactionPrompts } from './engine/prompts/context-compaction.js';
export type { DirectCompactionHooks } from './engine/recovery-compaction.js';
export {
  DirectContinuity,
  type DirectContinuityBinding,
  type PreparedDirectRequest,
} from './engine/recovery-continuity.js';
export { hasCompleteDirectToolPairs } from './engine/recovery-history.js';
export * from './engine/agent-runtime/run-budget.js';
export { resolveModelContextPolicy } from './engine/agent-runtime/model-context-policy.js';
export * from './model/index.js';
export * from './model/failure/retry-errors.js';
export * from './model/failure/retry-recovery-budget.js';
export type * from './tools/contracts.js';
export type * from './tools/nested-run-driver.js';
export * from './shared/cost/model-cost.js';
export type { NormalizedUsage } from './shared/utils/ai/token-usage.js';
