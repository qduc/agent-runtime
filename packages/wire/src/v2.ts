/** Version 2: one atomic accepted boundary, or explicitly non-resumable live changes. */
import { AGENT_EVENT_TYPES } from './v1.js';
import {
  configuration,
  exact,
  id,
  invalid,
  model,
  number,
  oneOf,
  ordinal,
  record,
  string,
} from './v2-values.js';
import type { AgentConfigurationV2, AgentModelV2 } from './v2-values.js';

export const AGENT_CHANGE_TYPES_V2 = [
  ...AGENT_EVENT_TYPES,
  'queue_changed',
  'session_rotated',
  'reasoning',
  'tool_progress',
  'tool_call_streaming_delta',
  'task_progress',
  'automatic_memory_notice',
  'command_started',
  'command_finished',
  'history_replaced',
  'configuration',
  'cost',
  'request_cost_recorded',
  'goal',
  'goal_proposed',
  'verification',
  'notice',
  'background_notice_enqueued',
  'background_notices_delivered',
  'message',
  'task_changed',
  'tool_called',
] as const;
export const AGENT_LIVE_CHANGE_TYPES_V2 = [
  'reasoning_delta',
  'tool_progress',
  'tool_call_streaming_delta',
  'task_progress',
  'automatic_memory_notice',
  'retry',
  'retry_exhausted',
  'error',
  'turn_failed',
] as const;
export type AgentAcceptedChangeTypeV2 = (typeof AGENT_CHANGE_TYPES_V2)[number];
export type AgentLiveChangeTypeV2 = (typeof AGENT_LIVE_CHANGE_TYPES_V2)[number];
export type AgentChangeTypeV2 = AgentAcceptedChangeTypeV2 | AgentLiveChangeTypeV2;
export type AgentBranchV2 = {
  readonly branchId: string;
  readonly taskId: string;
  readonly turnId: string;
  readonly parentTurnId?: string;
  readonly rootTurnId?: string;
};
export type AgentQueueChangeV2 =
  | {
      readonly type: 'queue_submitted';
      readonly record: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'queue_edited';
      readonly messageId: string;
      readonly content: readonly unknown[];
    }
  | { readonly type: 'queue_retracted'; readonly messageId: string }
  | { readonly type: 'queue_discarded'; readonly messageIds: readonly string[] }
  | {
      readonly type: 'queue_started';
      readonly messageId: string;
      readonly turnId: string;
    }
  | {
      readonly type: 'queue_steered';
      readonly messageIds: readonly string[];
      readonly turnId: string;
    }
  | {
      readonly type: 'queue_cancelling';
      readonly turnId: string;
      readonly cancelledMessageIds: readonly string[];
      readonly retainedMessageIds: readonly string[];
    }
  | {
      readonly type: 'queue_settled';
      readonly turnId: string;
      readonly outcome: 'completed' | 'cancelled' | 'failed' | 'interrupted';
      readonly preservePendingSteers?: boolean;
    }
  | { readonly type: 'queue_resumed' | 'queue_recovered' };
export type AgentSessionRotationV2 = {
  readonly logicalSessionId: string;
  readonly backingSessionId: string;
  readonly predecessor: {
    readonly sessionId: string;
    readonly throughSeq: number;
  };
  readonly commandId: string;
  readonly configuration: AgentConfigurationV2;
  readonly handoff?: {
    readonly clientRequestId: string;
    readonly messageId: string;
    readonly turnId: string;
  };
};
export type AgentContextEstimateV2 = {
  readonly renderedInputTokens: number;
  readonly outputReserveTokens: number;
  readonly safetyReserveTokens: number;
  readonly hardFitTokens: number;
};
export type AgentCompactionRequestV2 = {
  readonly requestId: string;
  readonly modelStep: number;
  readonly model: AgentModelV2;
  readonly outcome: 'completed' | 'failed' | 'cancelled';
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens: number;
  };
  readonly costUsd?: number | string;
};
export type AgentModelErrorV2 = {
  readonly kind:
    | 'authentication'
    | 'rate_limit'
    | 'network'
    | 'context_overflow'
    | 'invalid_request'
    | 'provider'
    | 'cancelled';
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
};
export type AgentCompactionFailureV2 =
  | {
      readonly kind: 'blocked';
      readonly reason:
        | 'disabled'
        | 'unknown_threshold'
        | 'native_unavailable'
        | 'unsettled_tools'
        | 'no_complete_cold_turn'
        | 'single_turn_too_large'
        | 'opaque_context'
        | 'summary_input_too_large'
        | 'non_reducing'
        | 'result_still_too_large';
    }
  | {
      readonly kind: 'interrupted';
      readonly reason: 'budget_wrap_up' | 'budget_exhausted';
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: AgentModelErrorV2 };
export type AgentCompactionStartV2 = {
  readonly turnId: string;
  readonly compactionId: string;
  readonly trigger: 'manual' | 'automatic';
  readonly model: AgentModelV2;
  readonly before: AgentContextEstimateV2;
  readonly strategy?: 'native' | 'local';
  readonly contextWindow?: number;
  readonly maxRequestInputTokens?: number | null;
  readonly lastCompletedInputTokens?: number;
};
export type AgentCompactionCompleteV2 = {
  readonly turnId: string;
  readonly compactionId: string;
  readonly strategy: 'native' | 'local';
  readonly after: AgentContextEstimateV2;
  readonly durationMs: number;
  readonly requests: readonly AgentCompactionRequestV2[];
};
export type AgentCompactionFailedV2 = {
  readonly turnId: string;
  readonly compactionId: string;
  readonly failure: AgentCompactionFailureV2;
  readonly durationMs: number;
  readonly requests: readonly AgentCompactionRequestV2[];
};
type NativePayloads = {
  queue_changed: Readonly<Record<string, unknown>> & {
    readonly change: AgentQueueChangeV2;
  };
  session_rotated: AgentSessionRotationV2;
  context_compaction_started: AgentCompactionStartV2;
  context_compaction_completed: AgentCompactionCompleteV2;
  context_compaction_failed: AgentCompactionFailedV2;
};
export type AgentChangePayloadsV2 = NativePayloads & {
  readonly [K in Exclude<AgentChangeTypeV2, keyof NativePayloads>]: Readonly<Record<string, unknown>>;
};
export type AgentChangeV2 = {
  [K in AgentChangeTypeV2]: {
    readonly type: K;
    readonly payload: AgentChangePayloadsV2[K];
    readonly branch?: AgentBranchV2;
  };
}[AgentChangeTypeV2];
export type AgentAcceptedEnvelopeV2 = {
  readonly schemaVersion: 2;
  readonly kind: 'accepted';
  readonly sessionId: string;
  readonly seq: number;
  readonly occurredAt: string;
  readonly changes: readonly Extract<AgentChangeV2, { type: AgentAcceptedChangeTypeV2 }>[];
};
export type AgentLiveEnvelopeV2 = {
  readonly schemaVersion: 2;
  readonly kind: 'live';
  readonly sessionId: string;
  readonly changes: readonly Extract<AgentChangeV2, { type: AgentLiveChangeTypeV2 }>[];
};
export type AgentEventEnvelopeV2 = AgentAcceptedEnvelopeV2 | AgentLiveEnvelopeV2;

/** Validate a v2 envelope in place. Ordering/provenance/replay are producer/consumer
 * obligations, not reconstructed by this stateless parser. V1 is never upgraded. */
export function parseAgentEventEnvelopeV2(value: unknown, expectedSessionId?: string): AgentEventEnvelopeV2 {
  const envelope = record(value);
  if (envelope.schemaVersion !== 2) invalid();
  if (envelope.kind === 'accepted') {
    exact(envelope, ['schemaVersion', 'kind', 'sessionId', 'seq', 'occurredAt', 'changes']);
    ordinal(envelope.seq);
    if (envelope.seq === 0) invalid();
    id(envelope.occurredAt);
  } else if (envelope.kind === 'live') {
    exact(envelope, ['schemaVersion', 'kind', 'sessionId', 'changes']);
  } else invalid();
  id(envelope.sessionId);
  if (expectedSessionId !== undefined && envelope.sessionId !== expectedSessionId) invalid();
  if (!Array.isArray(envelope.changes) || (envelope.kind === 'live' && envelope.changes.length === 0))
    invalid();
  for (const raw of envelope.changes as unknown[]) {
    const change = record(raw);
    exact(change, ['type', 'payload'], ['branch']);
    oneOf(change.type, envelope.kind === 'live' ? AGENT_LIVE_CHANGE_TYPES_V2 : AGENT_CHANGE_TYPES_V2);
    const payload = record(change.payload);
    if ('branch' in change) {
      const branch = record(change.branch);
      exact(branch, ['branchId', 'taskId', 'turnId'], ['parentTurnId', 'rootTurnId']);
      for (const key of Object.keys(branch)) id(branch[key]);
      if (
        (change.type === 'history_replaced' ||
          (typeof change.type === 'string' && change.type.startsWith('context_compaction_'))) &&
        'turnId' in payload &&
        payload.turnId !== branch.turnId
      )
        invalid();
    }
    switch (change.type) {
      case 'tool_called':
        validateToolCall(payload);
        break;
      case 'error':
        validateError(payload);
        break;
      case 'message':
        validateMessage(payload);
        break;
      case 'task_changed':
        if ('branch' in change) invalid();
        validateTaskChange(payload);
        break;
      case 'cost':
      case 'request_cost_recorded':
        // Root aggregate or physically scoped receipt: never a second branch charge.
        if ('branch' in change) invalid();
        break;
      case 'queue_changed':
        validateQueue(payload.change);
        break;
      case 'session_rotated':
        if ('branch' in change) invalid();
        validateRotation(payload, envelope.sessionId);
        break;
      case 'context_compaction_started':
      case 'context_compaction_completed':
      case 'context_compaction_failed':
        validateCompaction(change.type, payload);
        break;
      case 'history_replaced':
        oneOf(payload.reason, ['compaction', 'retry_turn', 'retry_tool', 'rewind']);
        if ('turnId' in payload) id(payload.turnId);
        if ('compactionId' in payload) {
          id(payload.compactionId);
          id(payload.turnId);
          if (payload.reason !== 'compaction') invalid();
        }
        break;
    }
  }
  return value as AgentEventEnvelopeV2;
}

function validateToolCall(payload: Record<string, unknown>): void {
  exact(payload, ['tool']);
  const tool = record(payload.tool);
  exact(tool, ['executionId', 'turnId', 'toolName', 'input', 'status'], [
    'parentExecutionId',
    'callId',
    'output',
    'isError',
    'progress',
    'display',
    'content',
  ]);
  for (const key of ['executionId', 'turnId']) id(tool[key]);
  string(tool.toolName);
  if (tool.toolName === '') invalid();
  for (const key of ['parentExecutionId', 'callId'])
    if (key in tool) id(tool[key]);
  oneOf(tool.status, ['called']);
  validateJson(tool.input);
  for (const key of ['output', 'progress'])
    if (key in tool) string(tool[key]);
  if ('isError' in tool && typeof tool.isError !== 'boolean') invalid();
  if ('display' in tool) validateJson(tool.display);
  if ('content' in tool && !Array.isArray(tool.content)) invalid();
}

function validateError(payload: Record<string, unknown>): void {
  exact(payload, ['error']);
  const error = record(payload.error);
  exact(error, ['kind', 'message'], ['retryable', 'retryAfterMs']);
  string(error.kind);
  string(error.message);
  if ('retryable' in error && typeof error.retryable !== 'boolean') invalid();
  if ('retryAfterMs' in error) number(error.retryAfterMs);
}

function validateJson(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  const values = Array.isArray(value) ? value : Object.values(record(value));
  for (const entry of values) validateJson(entry);
}

function validateMessage(payload: Record<string, unknown>): void {
  exact(payload, ['message'], ['replacesDraftId']);
  if ('replacesDraftId' in payload) id(payload.replacesDraftId);
  const message = record(payload.message);
  exact(message, ['id', 'role', 'content', 'text'], [
    'turnId',
    'modelStep',
    'executionId',
    'isError',
    'draft',
    'replacesDraftId',
  ]);
  id(message.id);
  oneOf(message.role, ['user', 'assistant', 'tool']);
  if (!Array.isArray(message.content)) invalid();
  string(message.text);
  for (const key of ['turnId', 'executionId', 'replacesDraftId'])
    if (key in message) id(message[key]);
  if ('modelStep' in message) ordinal(message.modelStep);
  for (const key of ['isError', 'draft'])
    if (key in message && typeof message[key] !== 'boolean') invalid();
}

function validateTaskChange(payload: Record<string, unknown>): void {
  exact(payload, ['change', 'at', 'task']);
  oneOf(payload.change, ['task_started', 'task_backgrounded', 'task_stop_requested', 'task_finished']);
  number(payload.at);
  const task = record(payload.task);
  exact(task, ['id', 'status'], [
    'turnId',
    'sessionId',
    'parentExecutionId',
    'sourceCallId',
    'origin',
    'agentId',
    'kind',
    'label',
    'input',
    'name',
    'role',
    'model',
    'mode',
    'startedAt',
    'lastActivityAt',
    'completedAt',
    'text',
    'progress',
    'result',
  ]);
  id(task.id);
  oneOf(task.status, [
    'running',
    'awaiting_interaction',
    'cancelling',
    'completed',
    'cancelled',
    'failed',
    'interrupted',
  ]);
  for (const key of ['turnId', 'sessionId', 'parentExecutionId', 'sourceCallId', 'agentId'])
    if (key in task) id(task[key]);
  for (const key of ['label', 'input', 'name', 'role', 'text', 'progress'])
    if (key in task) string(task[key]);
  for (const key of ['startedAt', 'lastActivityAt', 'completedAt'])
    if (key in task) number(task[key]);
  if ('kind' in task) oneOf(task.kind, ['shell', 'subagent']);
  if ('mode' in task) oneOf(task.mode, ['foreground', 'background']);
  if ('model' in task) model(task.model);
  if ('origin' in task) record(task.origin);
  if ('result' in task) {
    const result = record(task.result);
    exact(result, ['kind'], ['output', 'toolUseCounts', 'error', 'reason']);
    oneOf(result.kind, ['completed', 'cancelled', 'failed', 'interrupted']);
    for (const key of ['output', 'reason'])
      if (key in result) string(result[key]);
    if ('error' in result) record(result.error);
    if ('toolUseCounts' in result) {
      if (!Array.isArray(result.toolUseCounts)) invalid();
      const names = new Set<string>();
      for (const raw of result.toolUseCounts as unknown[]) {
        const count = record(raw);
        exact(count, ['toolName', 'count']);
        string(count.toolName);
        ordinal(count.count);
        if (count.toolName === '' || count.count === 0 || names.has(count.toolName as string)) invalid();
        names.add(count.toolName as string);
      }
    }
  }
}

function ids(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalid();
  const seen = new Set<string>();
  for (const entry of value) {
    id(entry);
    if (seen.has(entry as string)) invalid();
    seen.add(entry as string);
  }
  return value as string[];
}
function validateQueue(value: unknown): void {
  const change = record(value);
  switch (change.type) {
    case 'queue_submitted': {
      exact(change, ['type', 'record']);
      const submitted = record(change.record);
      id(submitted.messageId);
      id(submitted.clientRequestId);
      record(submitted.admission);
      break;
    }
    case 'queue_edited':
      exact(change, ['type', 'messageId', 'content']);
      id(change.messageId);
      if (!Array.isArray(change.content)) invalid();
      break;
    case 'queue_retracted':
      exact(change, ['type', 'messageId']);
      id(change.messageId);
      break;
    case 'queue_discarded':
      exact(change, ['type', 'messageIds']);
      ids(change.messageIds);
      break;
    case 'queue_started':
      exact(change, ['type', 'messageId', 'turnId']);
      id(change.messageId);
      id(change.turnId);
      break;
    case 'queue_steered':
      exact(change, ['type', 'messageIds', 'turnId']);
      ids(change.messageIds);
      id(change.turnId);
      break;
    case 'queue_cancelling': {
      exact(change, ['type', 'turnId', 'cancelledMessageIds', 'retainedMessageIds']);
      id(change.turnId);
      const cancelled = new Set(ids(change.cancelledMessageIds));
      for (const retained of ids(change.retainedMessageIds)) if (cancelled.has(retained)) invalid();
      break;
    }
    case 'queue_settled':
      exact(change, ['type', 'turnId', 'outcome'], ['preservePendingSteers']);
      id(change.turnId);
      oneOf(change.outcome, ['completed', 'cancelled', 'failed', 'interrupted']);
      if ('preservePendingSteers' in change && typeof change.preservePendingSteers !== 'boolean') invalid();
      break;
    case 'queue_resumed':
    case 'queue_recovered':
      exact(change, ['type']);
      break;
    default:
      invalid();
  }
}
function validateRotation(payload: Record<string, unknown>, sessionId: unknown): void {
  exact(
    payload,
    ['logicalSessionId', 'backingSessionId', 'predecessor', 'commandId', 'configuration'],
    ['handoff'],
  );
  id(payload.logicalSessionId);
  id(payload.backingSessionId);
  id(payload.commandId);
  if (payload.logicalSessionId !== sessionId) invalid();
  const predecessor = record(payload.predecessor);
  exact(predecessor, ['sessionId', 'throughSeq']);
  id(predecessor.sessionId);
  ordinal(predecessor.throughSeq);
  configuration(payload.configuration, true);
  if ('handoff' in payload) {
    const handoff = record(payload.handoff);
    exact(handoff, ['clientRequestId', 'messageId', 'turnId']);
    for (const key of Object.keys(handoff)) id(handoff[key]);
  }
}
function estimate(value: unknown): void {
  const e = record(value);
  const keys = ['renderedInputTokens', 'outputReserveTokens', 'safetyReserveTokens', 'hardFitTokens'];
  exact(e, keys);
  for (const key of keys) number(e[key]);
}
function validateCompaction(type: unknown, payload: Record<string, unknown>): void {
  id(payload.turnId);
  id(payload.compactionId);
  if (type === 'context_compaction_started') {
    exact(
      payload,
      ['turnId', 'compactionId', 'trigger', 'model', 'before'],
      ['strategy', 'contextWindow', 'maxRequestInputTokens', 'lastCompletedInputTokens'],
    );
    oneOf(payload.trigger, ['manual', 'automatic']);
    model(payload.model);
    estimate(payload.before);
    if ('strategy' in payload) oneOf(payload.strategy, ['native', 'local']);
    for (const key of ['contextWindow', 'lastCompletedInputTokens']) if (key in payload) number(payload[key]);
    if ('maxRequestInputTokens' in payload && payload.maxRequestInputTokens !== null)
      number(payload.maxRequestInputTokens);
    return;
  }
  const complete = type === 'context_compaction_completed';
  exact(payload, [
    'turnId',
    'compactionId',
    'durationMs',
    'requests',
    ...(complete ? ['strategy', 'after'] : ['failure']),
  ]);
  number(payload.durationMs);
  if (!Array.isArray(payload.requests)) invalid();
  const requestIds = new Set<string>();
  for (const raw of payload.requests as unknown[]) {
    const request = record(raw);
    exact(request, ['requestId', 'modelStep', 'model', 'outcome'], ['usage', 'costUsd']);
    id(request.requestId);
    ordinal(request.modelStep);
    model(request.model);
    oneOf(request.outcome, ['completed', 'failed', 'cancelled']);
    if (requestIds.has(request.requestId as string)) invalid();
    requestIds.add(request.requestId as string);
    if ('usage' in request) {
      const usage = record(request.usage);
      const keys = ['inputTokens', 'outputTokens', 'cachedInputTokens'];
      exact(usage, keys);
      for (const key of keys) number(usage[key]);
    }
    if ('costUsd' in request) {
      const cost = request.costUsd;
      if (
        (typeof cost !== 'number' && typeof cost !== 'string') ||
        (typeof cost === 'string' && !cost.trim()) ||
        !Number.isFinite(Number(cost)) ||
        Number(cost) < 0
      )
        invalid();
    }
  }
  if (complete) {
    oneOf(payload.strategy, ['native', 'local']);
    estimate(payload.after);
    return;
  }
  const failure = record(payload.failure);
  switch (failure.kind) {
    case 'blocked':
      exact(failure, ['kind', 'reason']);
      oneOf(failure.reason, [
        'disabled',
        'unknown_threshold',
        'native_unavailable',
        'unsettled_tools',
        'no_complete_cold_turn',
        'single_turn_too_large',
        'opaque_context',
        'summary_input_too_large',
        'non_reducing',
        'result_still_too_large',
      ]);
      break;
    case 'interrupted':
      exact(failure, ['kind', 'reason']);
      oneOf(failure.reason, ['budget_wrap_up', 'budget_exhausted']);
      break;
    case 'cancelled':
      exact(failure, ['kind']);
      break;
    case 'failed': {
      exact(failure, ['kind', 'error']);
      const error = record(failure.error);
      exact(error, ['kind', 'message', 'retryable'], ['retryAfterMs']);
      oneOf(error.kind, [
        'authentication',
        'rate_limit',
        'network',
        'context_overflow',
        'invalid_request',
        'provider',
        'cancelled',
      ]);
      string(error.message);
      if (typeof error.retryable !== 'boolean') invalid();
      if ('retryAfterMs' in error) number(error.retryAfterMs);
      break;
    }
    default:
      invalid();
  }
}
