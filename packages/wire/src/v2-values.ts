/** In-place v2 value validation. No defaults, coercion, truncation or provenance inference. */
import { AgentWireError } from './v1.js';

export type AgentModelV2 = {
  readonly provider: string;
  readonly model: string;
};
export type AgentReasoningV2 = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type AgentConfigurationV2 = {
  readonly model: AgentModelV2;
  readonly reasoning?: AgentReasoningV2;
  readonly temperature?: number;
};
export type AgentConfigureSelectionV2 = {
  readonly model?: AgentModelV2;
  readonly reasoning?: 'default' | AgentReasoningV2;
  readonly temperature?: number;
  readonly profileId?: string;
};

export function invalid(): never {
  throw new AgentWireError('invalid agent wire v2 value');
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
export function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid();
}
export function string(value: unknown): void {
  if (typeof value !== 'string') invalid();
}
export function id(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) invalid();
}
export function number(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid();
}
export function ordinal(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
}
export function oneOf(value: unknown, choices: readonly string[]): void {
  if (typeof value !== 'string' || !choices.includes(value)) invalid();
}
export function model(value: unknown): void {
  const m = record(value);
  exact(m, ['provider', 'model']);
  id(m.provider);
  id(m.model);
}
export function configuration(value: unknown, accepted: boolean): void {
  const c = record(value);
  exact(
    c,
    accepted ? ['model'] : [],
    accepted ? ['reasoning', 'temperature'] : ['model', 'reasoning', 'temperature', 'profileId'],
  );
  if ('model' in c) model(c.model);
  if ('reasoning' in c)
    oneOf(c.reasoning, [
      ...(accepted ? [] : ['default']),
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  if ('temperature' in c && (typeof c.temperature !== 'number' || !Number.isFinite(c.temperature))) invalid();
  if ('profileId' in c) id(c.profileId);
}
