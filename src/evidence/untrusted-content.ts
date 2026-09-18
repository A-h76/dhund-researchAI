/**
 * External-source and evidence text is untrusted content.
 * Store it as data; never place it in system instructions.
 */
export const UNTRUSTED_EXTERNAL_CONTENT = true;

export function retainAsUntrustedContent(text: string): string {
  return text;
}
