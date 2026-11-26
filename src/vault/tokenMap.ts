/**
 * Deterministic, reversible token registry shared by the local scrubber, the
 * regex firewall, the wire boundary, and the local rehydration stage.
 *
 * `tokenMap` maps token -> original value (e.g. "[PERSON_1]" -> "Rohan Sharma").
 * `reverseMap` maps lowercased original -> token so the same value always gets
 * the same token, across chunks and across scrub passes.
 */

export type EntityCategory =
  | "PERSON"
  | "ORG"
  | "ADDRESS"
  | "ID_NUMBER"
  | "CONTACT"
  | "DATE"
  | "ACCOUNT"
  | "MANUAL";

const TOKEN_PREFIX: Record<EntityCategory, string> = {
  PERSON: "PERSON",
  ORG: "ORG",
  ADDRESS: "ADDRESS",
  ID_NUMBER: "ID",
  CONTACT: "CONTACT",
  DATE: "DATE",
  ACCOUNT: "ACCOUNT",
  MANUAL: "MANUAL",
};

const TOKEN_PATTERN = /^\[[A-Z][A-Z0-9_]*_\d+\]$/;

export interface TokenMaps {
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
}

export function normalizeEntity(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

/**
 * Case-insensitive replacement with word boundaries where the needle is
 * alphanumeric. Used by the local scrubber so a model that returns "Rohan
 * Sharma" still redacts "ROHAN SHARMA" in the source.
 */
export function replaceAllInsensitive(
  haystack: string,
  needle: string,
  replacement: string
): string {
  const clean = normalizeEntity(needle);
  if (clean.length < 2) return haystack;
  const prefix = /^[A-Za-z0-9]/.test(clean) ? "\\b" : "";
  const suffix = /[A-Za-z0-9]$/.test(clean) ? "\\b" : "";
  const expression = new RegExp(`${prefix}${escapeRegExp(clean)}${suffix}`, "gi");
  return haystack.replace(expression, () => replacement);
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function mergeTokenMaps(
  base: TokenMaps,
  addition: Partial<TokenMaps>
): TokenMaps {
  return {
    tokenMap: { ...base.tokenMap, ...(addition.tokenMap ?? {}) },
    reverseMap: { ...base.reverseMap, ...(addition.reverseMap ?? {}) },
  };
}

export class TokenRegistry {
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
  private counters: Record<string, number> = {};
  private readonly sourceText: string;

  constructor(seed: Partial<TokenMaps> = {}, sourceText = "") {
    this.tokenMap = {};
    this.reverseMap = {};
    this.sourceText = sourceText;

    for (const [token, original] of Object.entries(seed.tokenMap ?? {})) {
      if (!isValidToken(token)) continue;
      const clean = normalizeEntity(original);
      if (!clean) continue;
      this.tokenMap[token] = clean;
      this.reverseMap[clean.toLowerCase()] = token;
    }

    for (const [original, token] of Object.entries(seed.reverseMap ?? {})) {
      if (!isValidToken(token)) continue;
      const clean = normalizeEntity(original);
      if (!clean) continue;
      if (!this.tokenMap[token]) this.tokenMap[token] = clean;
      this.reverseMap[clean.toLowerCase()] = token;
    }

    for (const token of Object.keys(this.tokenMap)) {
      const match = token.match(/^\[([A-Z][A-Z0-9_]*)_(\d+)\]$/);
      if (!match) continue;
      const prefix = match[1];
      const value = Number(match[2]);
      this.counters[prefix] = Math.max(this.counters[prefix] ?? 0, value);
    }
  }

  get size(): number {
    return Object.keys(this.tokenMap).length;
  }

  lookup(original: string): string | undefined {
    return this.reverseMap[normalizeEntity(original).toLowerCase()];
  }

  tokenExists(token: string): boolean {
    return Boolean(this.tokenMap[token]);
  }

  register(original: string, category: EntityCategory): string | null {
    const clean = normalizeEntity(original);
    if (clean.length < 2) return null;
    const key = clean.toLowerCase();
    const existing = this.reverseMap[key];
    if (existing) return existing;

    const prefix = TOKEN_PREFIX[category];
    let counter = this.counters[prefix] ?? 0;
    let token = "";
    do {
      counter += 1;
      token = `[${prefix}_${counter}]`;
    } while (
      this.tokenMap[token] ||
      this.sourceText.includes(token) ||
      this.reverseMap[key] === token
    );

    this.counters[prefix] = counter;
    this.tokenMap[token] = clean;
    this.reverseMap[key] = token;
    return token;
  }

  absorb(maps: Partial<TokenMaps>): void {
    for (const [token, original] of Object.entries(maps.tokenMap ?? {})) {
      if (!isValidToken(token)) continue;
      const clean = normalizeEntity(original);
      if (!clean) continue;
      if (!this.tokenMap[token]) this.tokenMap[token] = clean;
      this.reverseMap[clean.toLowerCase()] = token;
      const match = token.match(/^\[([A-Z][A-Z0-9_]*)_(\d+)\]$/);
      if (match) {
        this.counters[match[1]] = Math.max(this.counters[match[1]] ?? 0, Number(match[2]));
      }
    }
    for (const [original, token] of Object.entries(maps.reverseMap ?? {})) {
      if (!isValidToken(token)) continue;
      const clean = normalizeEntity(original);
      if (!clean) continue;
      this.reverseMap[clean.toLowerCase()] = token;
      if (!this.tokenMap[token]) this.tokenMap[token] = clean;
    }
  }

  snapshot(): TokenMaps {
    return { tokenMap: { ...this.tokenMap }, reverseMap: { ...this.reverseMap } };
  }
}
