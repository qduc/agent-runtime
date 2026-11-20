import type { Item } from '../model/index.js';

/** One receipt line per settled call: `- name: arguments → first output line`, each clipped. */
export function toolReceipts(
  history: readonly Item[],
  receiptArguments: (toolName: string, rawArguments: string) => string = (_name, args) => args,
): readonly string[] {
  const calls = new Map<string, Extract<Item, { type: 'tool_call' }>>();
  const receipts = new Map<string, string>();
  for (const item of history) {
    if (item.type === 'tool_call') calls.set(item.callId, item);
    const call = item.type === 'tool_result' ? calls.get(item.callId) : undefined;
    if (item.type !== 'tool_result' || !call) continue;
    const args = call.rawArguments ?? JSON.stringify(call.input ?? {});
    const output = item.output
      .slice(0, 128)
      .split('\n')
      .find((line) => line.trim() && !line.startsWith('[truncated'));
    receipts.set(
      item.callId,
      `- ${call.toolName}: ${clip(receiptArguments(call.toolName, args), 100)} → ${clip(output ?? '(no output)', 80)}`,
    );
  }
  return [...receipts.values()];
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
