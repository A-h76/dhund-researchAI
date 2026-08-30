export const AI_CAPABILITIES = [
  'CHAT',
  'EMBED',
  'RERANK',
  'EXTRACT_CELL',
  'SCREENING',
  'STANCE',
  'SYNTHESIS',
  'OCR',
  'AUTOCOMPLETE',
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export function isAiCapability(value: string): value is AiCapability {
  return (AI_CAPABILITIES as readonly string[]).includes(value);
}
