/**
 * Pure, validated token rehydration.
 *
 * A single alternation pass (longest tokens first) prevents `[PATIENT_1]` from
 * corrupting `[PATIENT_10]`, and replacement values are never re-scanned.
 * Unknown tokens are left untouched; only token-shaped map keys are used.
 */

import { escapeRegExp, isValidToken } from "./tokenMap";

export interface RehydrateResult {
  text: string;
  replaced: number;
  unknownTokens: string[];
}

export const TOKEN_SCAN = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

export function rehydrateText(
  text: string,
  tokenMap: Record<string, string>
): RehydrateResult {
  const valid = Object.entries(tokenMap)
    .filter(([token, original]) => isValidToken(token) && Boolean(original))
    .sort((a, b) => b[0].length - a[0].length);

  let replaced = 0;
  let output = text;

  const replacements = new Map(valid);
  if (valid.length > 0 && text) {
    const pattern = new RegExp(valid.map(([token]) => escapeRegExp(token)).join("|"), "g");
    output = text.replace(pattern, (match) => {
      const original = replacements.get(match);
      if (original === undefined) return match;
      replaced += 1;
      return original;
    });
  }

  const unknown = new Set<string>();
  for (const token of text.match(TOKEN_SCAN) ?? []) {
    if (!tokenMap[token]) unknown.add(token);
  }

  return { text: output, replaced, unknownTokens: [...unknown] };
}
