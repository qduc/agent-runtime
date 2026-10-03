import { describe, expect, it } from 'vitest';
import {
  AGENT_EVENT_TYPES,
  AgentWireError,
  FROZEN_AGENT_EVENT_TYPES,
  parseAgentEventEnvelope,
  validatePendingInteractionDto,
} from './index.js';

// Frozen event-type snapshot captured from Term2's
// source/gateway/persistence/contracts.ts at source commit 63fbfd8a
// (release preparation 41de330f). The gate contract must not drift silently.
const FROZEN_EVENT_TYPE_SNAPSHOT = [
  'session_created',
  'user_message_accepted',
  'user_message_rejected',
  'assistant_started',
  'text_delta',
  'reasoning_delta',
  'tool_started',
  'command_message',
  'approval_required',
  'interaction_updated',
  'interaction_resolved',
  'interaction_recovered',
  'usage_update',
  'retry',
  'retry_exhausted',
  'subagent_started',
  'subagent_tool_started',
  'subagent_text_turn',
  'subagent_command_message',
  'subagent_approval_required',
  'subagent_completed',
  'subagent_interrupted',
  'subagent_question',
  'context_compaction_started',
  'context_compaction_completed',
  'context_compaction_failed',
  'turn_completed',
  'turn_failed',
  'turn_aborted',
] as const;

describe('agent wire event contract', () => {
  it('exports the current frozen event-type set', () => {
    expect(new Set(AGENT_EVENT_TYPES)).toEqual(new Set(FROZEN_AGENT_EVENT_TYPES));
    expect(FROZEN_AGENT_EVENT_TYPES).toEqual(FROZEN_EVENT_TYPE_SNAPSHOT);
  });
});

describe('agent event envelope parsing', () => {
  const envelope = {
    schemaVersion: 1 as const,
    id: 7,
    sessionId: 'session-1',
    type: 'turn_completed' as const,
    occurredAt: '2026-10-03T00:00:00Z',
    payload: {},
  };

  it('accepts a valid envelope and preserves fields', () => {
    expect(parseAgentEventEnvelope(envelope, 'session-1')).toEqual(envelope);
  });

  it('accepts an envelope without an expected session id', () => {
    expect(parseAgentEventEnvelope(envelope)).toEqual(envelope);
  });

  it('rejects a session identity mismatch', () => {
    expect(() => parseAgentEventEnvelope(envelope, 'another-session')).toThrow(AgentWireError);
  });

  it('rejects unknown event types', () => {
    expect(() =>
      parseAgentEventEnvelope({ ...envelope, type: 'not_a_real_event' }),
    ).toThrow(AgentWireError);
  });

  it('rejects unsupported schema versions and unsafe ids', () => {
    expect(() => parseAgentEventEnvelope({ ...envelope, schemaVersion: 2 })).toThrow(AgentWireError);
    expect(() => parseAgentEventEnvelope({ ...envelope, id: 0 })).toThrow(AgentWireError);
    expect(() => parseAgentEventEnvelope({ ...envelope, id: 1.5 })).toThrow(AgentWireError);
  });

  it('rejects non-object input and unknown keys', () => {
    expect(() => parseAgentEventEnvelope(null)).toThrow(AgentWireError);
    expect(() => parseAgentEventEnvelope('envelope')).toThrow(AgentWireError);
    expect(() => parseAgentEventEnvelope({ ...envelope, extra: true })).toThrow(AgentWireError);
  });

  it('rejects control characters in text fields', () => {
    expect(() => parseAgentEventEnvelope({ ...envelope, occurredAt: 'bad\u0000value' })).toThrow(AgentWireError);
  });
});

describe('pending interaction dto validation', () => {
  const dto = (optionCount: number) => ({
    version: 1 as const,
    interactionId: 'interaction-1',
    kind: 'ask_user' as const,
    variant: 'ask_user' as const,
    descriptor: { agentName: 'agent', toolName: 'ask_user', argumentsText: '{}' },
    choices: [{ id: 'approve', label: 'Approve' }],
    askUser: {
      questions: [
        {
          index: 0,
          question: 'Pick one',
          options: Array.from({ length: optionCount }, (_, index) => ({ label: `Option ${index}` })),
          multiSelect: false,
        },
      ],
      answers: [],
      currentQuestionIndex: 0,
    },
    revision: 1,
  });

  it('accepts 32 options', () => {
    expect(validatePendingInteractionDto(dto(32))).toBeDefined();
  });

  it('rejects 33 options', () => {
    expect(() => validatePendingInteractionDto(dto(33))).toThrow(AgentWireError);
  });

  it('rejects kind/variant contradictions', () => {
    expect(() => validatePendingInteractionDto({ ...dto(1), kind: 'tool_approval' })).toThrow(AgentWireError);
  });

  it('rejects empty choices and oversized arguments text', () => {
    const emptyChoices = dto(1);
    expect(() => validatePendingInteractionDto({ ...emptyChoices, choices: [] })).toThrow(AgentWireError);
    const longArguments = dto(1);
    longArguments.descriptor.argumentsText = 'x'.repeat(8193);
    expect(() => validatePendingInteractionDto(longArguments)).toThrow(AgentWireError);
  });

  it('rejects an out-of-range current question index', () => {
    const broken = dto(1);
    broken.askUser!.currentQuestionIndex = 5;
    expect(() => validatePendingInteractionDto(broken)).toThrow(AgentWireError);
  });
});
