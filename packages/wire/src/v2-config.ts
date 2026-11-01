/** Native keyed configuration receipts, not a current-state discovery projection. */
import { configuration, exact, id, invalid, oneOf, record, string } from './v2-values.js';
import type { AgentConfigurationV2, AgentConfigureSelectionV2 } from './v2-values.js';
export type {
  AgentConfigurationV2,
  AgentConfigureSelectionV2,
  AgentModelV2,
  AgentReasoningV2,
} from './v2-values.js';

export type AgentConfigureOutcomeV2 =
  | {
      readonly kind: 'configured';
      readonly configuration: AgentConfigurationV2;
    }
  | {
      readonly kind: 'rejected';
      readonly code: 'ineligible' | 'stale' | 'busy' | 'unavailable' | 'cancelled' | 'failed';
      readonly message: string;
    }
  | { readonly kind: 'interrupted'; readonly reason: 'outcome_unobserved' };
export type AgentConfigureReceiptV2 = {
  readonly request: {
    readonly commandId: string;
    readonly operation: {
      readonly kind: 'configure';
      readonly configuration: AgentConfigureSelectionV2;
    };
    readonly admission?: 'idle';
    readonly expectedRevision?: string;
  };
  /** Original admission revision, never inferred post-install revision. */
  readonly revision: string;
  readonly outcome?: AgentConfigureOutcomeV2;
};
export type AgentConfigureCommandResultV2 =
  | {
      readonly ok: true;
      readonly kind: 'command_pending';
      readonly replayed?: boolean;
      readonly receipt: AgentConfigureReceiptV2 & { readonly outcome?: never };
    }
  | {
      readonly ok: true;
      readonly kind: 'command_finished';
      readonly replayed?: boolean;
      readonly receipt: AgentConfigureReceiptV2 & {
        readonly outcome: Extract<AgentConfigureOutcomeV2, { kind: 'configured' }>;
      };
    }
  | {
      readonly ok: false;
      readonly code: 'command_rejected';
      readonly replayed?: boolean;
      readonly commandId: string;
      readonly message: string;
      readonly receipt: AgentConfigureReceiptV2 & {
        readonly outcome: Extract<AgentConfigureOutcomeV2, { kind: 'rejected' }>;
      };
    }
  | {
      readonly ok: false;
      readonly code: 'command_interrupted';
      readonly replayed?: boolean;
      readonly commandId: string;
      readonly message: string;
      readonly receipt: AgentConfigureReceiptV2 & {
        readonly outcome: Extract<AgentConfigureOutcomeV2, { kind: 'interrupted' }>;
      };
    }
  | {
      readonly ok: false;
      readonly code:
        | 'invalid_command'
        | 'unavailable'
        | 'stale_interaction'
        | 'request_conflict'
        | 'rejected'
        | 'closed'
        | 'not_found'
        | 'forbidden'
        | 'storage_failure'
        | 'too_late'
        | 'internal_error'
        | 'replay_unavailable'
        | 'not_admitting';
      readonly message: string;
      readonly commandId?: string;
    };
export type AgentConfigureResultV2 = {
  readonly schemaVersion: 2;
  readonly sessionId: string;
  readonly result: AgentConfigureCommandResultV2;
};

/** Parse a configure-only native result in its versioned HTTP wrapper, retaining optionality.
 * No HTTP status, success, current profile, replay provenance or receipt is manufactured. */
export function parseAgentConfigureResultV2(
  value: unknown,
  expectedSessionId?: string,
): AgentConfigureResultV2 {
  const envelope = record(value);
  exact(envelope, ['schemaVersion', 'sessionId', 'result']);
  if (envelope.schemaVersion !== 2) invalid();
  id(envelope.sessionId);
  if (expectedSessionId !== undefined && envelope.sessionId !== expectedSessionId) invalid();
  const result = record(envelope.result);
  const hasReceipt =
    result.ok === true || result.code === 'command_rejected' || result.code === 'command_interrupted';
  if (!hasReceipt) {
    exact(result, ['ok', 'code', 'message'], ['commandId']);
    if (result.ok !== false) invalid();
    oneOf(result.code, [
      'invalid_command',
      'unavailable',
      'stale_interaction',
      'request_conflict',
      'rejected',
      'closed',
      'not_found',
      'forbidden',
      'storage_failure',
      'too_late',
      'internal_error',
      'replay_unavailable',
      'not_admitting',
    ]);
    string(result.message);
    if ('commandId' in result) id(result.commandId);
    return value as AgentConfigureResultV2;
  }
  if (result.ok === true) {
    exact(result, ['ok', 'kind', 'receipt'], ['replayed']);
    oneOf(result.kind, ['command_pending', 'command_finished']);
  } else {
    exact(result, ['ok', 'code', 'commandId', 'message', 'receipt'], ['replayed']);
    if (result.ok !== false) invalid();
    oneOf(result.code, ['command_rejected', 'command_interrupted']);
    id(result.commandId);
    string(result.message);
  }
  if ('replayed' in result && typeof result.replayed !== 'boolean') invalid();
  const receipt = record(result.receipt);
  exact(receipt, ['request', 'revision'], ['outcome']);
  id(receipt.revision);
  const request = record(receipt.request);
  exact(request, ['commandId', 'operation'], ['admission', 'expectedRevision']);
  id(request.commandId);
  if ('admission' in request && request.admission !== 'idle') invalid();
  if ('expectedRevision' in request) id(request.expectedRevision);
  const operation = record(request.operation);
  exact(operation, ['kind', 'configuration']);
  if (operation.kind !== 'configure') invalid();
  configuration(operation.configuration, false);
  if (result.ok === false && result.commandId !== request.commandId) invalid();
  if (result.kind === 'command_pending') {
    if ('outcome' in receipt) invalid();
  } else {
    const outcome = record(receipt.outcome);
    if (result.ok === true) {
      exact(outcome, ['kind', 'configuration']);
      if (outcome.kind !== 'configured') invalid();
      configuration(outcome.configuration, true);
    } else if (result.code === 'command_rejected') {
      exact(outcome, ['kind', 'code', 'message']);
      if (outcome.kind !== 'rejected') invalid();
      oneOf(outcome.code, ['ineligible', 'stale', 'busy', 'unavailable', 'cancelled', 'failed']);
      string(outcome.message);
    } else {
      exact(outcome, ['kind', 'reason']);
      if (outcome.kind !== 'interrupted' || outcome.reason !== 'outcome_unobserved') invalid();
    }
  }
  return value as AgentConfigureResultV2;
}
