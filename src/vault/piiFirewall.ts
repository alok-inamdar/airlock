/**
 * Defense-in-depth deterministic PII firewall.
 *
 * Runs synchronously inside `toWire()` after local model redaction and before
 * anything can cross the wire. Deliberately ignores CPT/HCPCS codes and dollar
 * amounts so billing analysis stays useful.
 */

import {
  mergeTokenMaps,
  type TokenMaps,
} from "./tokenMap";

export type PiiCategory =
  | "SSN"
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "DOB"
  | "MRN"
  | "AADHAAR"
  | "PAN"
  | "BANK"
  | "POLICY";

export interface FirewallHit {
  category: PiiCategory;
  original: string;
  token: string;
  start: number;
  end: number;
}

export interface FirewallDetection {
  category: PiiCategory;
  original: string;
  start: number;
  end: number;
}

export interface FirewallResult extends TokenMaps {
  text: string;
  hits: FirewallHit[];
}

interface DetectionPattern {
  category: PiiCategory;
  regex: RegExp;
  validate?: (value: string) => boolean;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (!Number.isFinite(value)) return false;
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const PATTERNS: DetectionPattern[] = [
  {
    category: "SSN",
    regex: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
  },
  {
    category: "EMAIL",
    regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    category: "PHONE",
    regex: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s*|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g,
  },
  {
    category: "PHONE",
    regex: /\+\d{1,3}[\s.-]?\d{5}[\s.-]?\d{5}\b/g,
  },
  {
    category: "PHONE",
    regex: /\b\d{10}\b/g,
  },
  {
    category: "CARD",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhnValid(digits);
    },
  },
  {
    category: "DOB",
    regex:
      /\b(?:DOB|D\.O\.B\.?|Date of Birth)\s*[:#]?\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/gi,
  },
  {
    category: "MRN",
    regex: /\b(?:MRN|Medical Record (?:Number|No\.?)|Patient ID)\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/gi,
  },
  {
    category: "AADHAAR",
    regex: /\b[2-9]\d{3}\s\d{4}\s\d{4}\b/g,
  },
  {
    category: "PAN",
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  },
  {
    category: "POLICY",
    regex:
      /\b(?:Policy|Insurance)\s*(?:Number|No\.?|ID|#)\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/gi,
  },
  {
    category: "POLICY",
    regex: /\bPolicy\s*[:#]\s*[A-Z0-9][A-Z0-9-]{3,}\b/gi,
  },
  {
    category: "BANK",
    regex: /\b(?:Routing|ABA|RTN)\s*(?:Number|No\.?|#)?\s*[:#]?\s*\d{9}\b/gi,
  },
  {
    category: "BANK",
    regex: /\b(?:Account|Acct)\s*(?:Number|No\.?|#)?\s*[:#]?\s*[0-9][0-9 -]{3,19}\b/gi,
  },
];

function collect(text: string): Array<FirewallDetection & { category: PiiCategory }> {
  const found: FirewallDetection[] = [];
  for (const pattern of PATTERNS) {
    const expression = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match = expression.exec(text);
    while (match) {
      const value = match[0];
      if (match[0].length === 0) {
        expression.lastIndex += 1;
      } else if (!pattern.validate || pattern.validate(value)) {
        found.push({
          category: pattern.category,
          original: value,
          start: match.index,
          end: match.index + value.length,
        });
      }
      match = expression.exec(text);
    }
  }

  found.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const nonOverlapping: FirewallDetection[] = [];
  let cursor = -1;
  for (const detection of found) {
    if (detection.start < cursor) continue;
    nonOverlapping.push(detection);
    cursor = detection.end;
  }
  return nonOverlapping;
}

/** Detect residual direct identifiers without mutating the text. */
export function detectPii(text: string): FirewallDetection[] {
  return collect(text);
}

export function firewallPassed(text: string): boolean {
  return detectPii(text).length === 0;
}

/**
 * Replace every residual direct identifier with a deterministic
 * `[REDACTED_REGEX_N]` token, reusing tokens for repeated values and adding
 * every original to the local token map so rehydration still works.
 */
export function runPiiFirewall(text: string, seed: Partial<TokenMaps> = {}): FirewallResult {
  const detections = collect(text);
  const tokenMap: Record<string, string> = { ...(seed.tokenMap ?? {}) };
  const reverseMap: Record<string, string> = { ...(seed.reverseMap ?? {}) };
  const hits: FirewallHit[] = [];

  let output = "";
  let cursor = 0;
  let counter = 0;

  for (const detection of detections) {
    const key = detection.original.toLowerCase();
    let token = reverseMap[key];
    if (!token) {
      let candidate = "";
      do {
        counter += 1;
        candidate = `[REDACTED_REGEX_${counter}]`;
      } while (tokenMap[candidate] || text.includes(candidate));
      token = candidate;
      tokenMap[token] = detection.original;
      reverseMap[key] = token;
    }
    output += text.slice(cursor, detection.start);
    output += token;
    cursor = detection.end;
    hits.push({
      category: detection.category,
      original: detection.original,
      token,
      start: detection.start,
      end: detection.end,
    });
  }
  output += text.slice(cursor);

  return { text: output, hits, tokenMap, reverseMap };
}

export function mergeFirewallResult(
  base: TokenMaps,
  result: FirewallResult
): TokenMaps {
  return mergeTokenMaps(base, { tokenMap: result.tokenMap, reverseMap: result.reverseMap });
}

export const FIREWALL_CATEGORY_LABEL: Record<PiiCategory, string> = {
  SSN: "SSN",
  EMAIL: "Email",
  PHONE: "Phone",
  CARD: "Card",
  DOB: "Date of birth",
  MRN: "Medical record #",
  AADHAAR: "Aadhaar",
  PAN: "PAN",
  BANK: "Bank account",
  POLICY: "Policy ID",
};
