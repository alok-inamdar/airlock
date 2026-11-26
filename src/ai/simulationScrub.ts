/**
 * Deterministic, no-model extraction used by Simulation Mode and as the
 * per-chunk fallback when the on-device model returns unusable JSON.
 *
 * This is intentionally honest: it catches structured IDs plus a handful of
 * labelled names, organizations, and street addresses. It cannot match a
 * local LLM's semantic recall, and the UI says so.
 */

import type { DocumentType, ExtractedItem } from "../types";
import { chunkText } from "../vault/chunker";
import {
  runPiiFirewall,
  type FirewallHit,
  type PiiCategory,
} from "../vault/piiFirewall";
import { replaceAllInsensitive, TokenRegistry, type EntityCategory } from "../vault/tokenMap";
import { byteSize, type LocalScrubEntity } from "../vault/wireBoundary";

export interface ScrubEntityCandidate {
  text: string;
  category: EntityCategory;
  role?: string;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "patient",
  "tenant",
  "landlord",
  "employer",
  "employee",
  "hospital",
  "clinic",
  "account",
  "amount",
  "total",
  "date",
  "name",
  "signature",
  "page",
  "invoice",
  "statement",
  "bill",
  "lease",
  "agreement",
  "contract",
  "section",
  "exhibit",
  "notice",
  "payment",
  "balance",
  "insurance",
  "policy",
  "provider",
  "service",
  "description",
  "charges",
  "address",
]);

const LABEL_ROLE: Record<string, { category: EntityCategory; role?: string }> = {
  patient: { category: "PERSON", role: "patient" },
  "patient name": { category: "PERSON", role: "patient" },
  tenant: { category: "PERSON", role: "tenant" },
  landlord: { category: "PERSON", role: "landlord" },
  guarantor: { category: "PERSON", role: "guarantor" },
  claimant: { category: "PERSON", role: "claimant" },
  insured: { category: "PERSON", role: "insured" },
  employee: { category: "PERSON", role: "employee" },
  provider: { category: "PERSON", role: "physician" },
  physician: { category: "PERSON", role: "physician" },
  attending: { category: "PERSON", role: "physician" },
  "employee name": { category: "PERSON", role: "employee" },
  "prepared for": { category: "PERSON" },
  "prepared by": { category: "PERSON" },
  name: { category: "PERSON" },
  insurer: { category: "ORG", role: "insurer" },
  "health plan": { category: "ORG", role: "insurer" },
  "for the company": { category: "PERSON", role: "employer" },
  employer: { category: "ORG", role: "employer" },
  clinic: { category: "ORG", role: "clinic" },
  hospital: { category: "ORG", role: "clinic" },
  company: { category: "ORG" },
  attention: { category: "PERSON" },
  attn: { category: "PERSON" },
  "signed by": { category: "PERSON" },
};

function trimCandidate(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .trim();
}

function normalizeCategory(value: unknown): EntityCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["person", "name", "per", "human", "individual"].includes(normalized)) return "PERSON";
  if (
    ["org", "organization", "organisation", "company", "business", "clinic", "hospital", "institution"].includes(
      normalized
    )
  ) {
    return "ORG";
  }
  if (["address", "addr", "location", "street", "postal_address"].includes(normalized)) {
    return "ADDRESS";
  }
  if (
    ["id", "id_number", "identifier", "ssn", "mrn", "aadhaar", "pan", "passport", "license", "government_id"].includes(
      normalized
    )
  ) {
    return "ID_NUMBER";
  }
  if (
    ["contact", "email", "phone", "telephone", "mobile", "contact_info"].includes(normalized)
  ) {
    return "CONTACT";
  }
  if (["date", "dob", "birth", "date_of_birth", "birthday"].includes(normalized)) return "DATE";
  if (
    ["account", "account_number", "bank", "bank_account", "routing", "card", "financial", "policy", "insurance_id"].includes(
      normalized
    )
  ) {
    return "ACCOUNT";
  }
  if (normalized === "manual") return "MANUAL";

  // Tolerant fallbacks for model-generated labels such as "patient_name".
  if (normalized.includes("person") || normalized.includes("name")) return "PERSON";
  if (normalized.includes("addr") || normalized.includes("location")) return "ADDRESS";
  if (normalized.includes("phone") || normalized.includes("email")) return "CONTACT";
  if (normalized.includes("birth")) return "DATE";
  if (normalized.includes("medical_record") || normalized.includes("mrn")) return "ID_NUMBER";
  if (
    normalized.includes("account") ||
    normalized.includes("routing") ||
    normalized.includes("card")
  ) {
    return "ACCOUNT";
  }
  if (
    normalized.includes("org") ||
    normalized.includes("company") ||
    normalized.includes("clinic") ||
    normalized.includes("hospital")
  ) {
    return "ORG";
  }
  if (normalized.endsWith("_id") || normalized.includes("identification")) return "ID_NUMBER";
  return null;
}

function isUnsafeCandidate(text: string, category: EntityCategory): boolean {
  const lower = text.toLowerCase();
  if (text.length < 2 || text.length > 140) return true;
  if (lower.includes("untrusted_document")) return true;
  if (STOPWORDS.has(lower)) return true;
  if (/^\$?\s*[\d,]+\.\d{1,2}\s*$/.test(text)) return true;
  if (/^\d{5}$/.test(text)) return true;
  // Never let a model redact billing codes, NDC identifiers, or dollar amounts.
  if (/\b(?:CPT|HCPCS|NDC)\b/i.test(text)) return true;
  if (/\$\s?[\d,]+(?:\.\d{1,2})?/.test(text)) return true;
  if (/^[\d\s.,-]+$/.test(text)) {
    return !(
      (category === "ACCOUNT" || category === "ID_NUMBER" || category === "DATE") &&
      text.replace(/\D/g, "").length >= 6
    );
  }
  return false;
}

function pushCandidate(
  target: ScrubEntityCandidate[],
  seen: Set<string>,
  text: string,
  category: EntityCategory,
  role?: string
): void {
  const clean = trimCandidate(text);
  if (!clean) return;
  if (isUnsafeCandidate(clean, category)) return;
  const key = `${category}::${clean.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ text: clean, category, ...(role ? { role } : {}) });
}

function collectMatches(
  text: string,
  regex: RegExp,
  group: number,
  handler: (value: string, match: RegExpExecArray) => void
): void {
  const expression = new RegExp(regex.source, regex.flags);
  let match = expression.exec(text);
  while (match) {
    const value = match[group];
    if (value) handler(value, match);
    match = expression.exec(text);
  }
}

/** Parse a model response into validated entity candidates. */
export function parseEntityCandidates(raw: string): ScrubEntityCandidate[] | null {
  const candidates = extractJsonValue(raw);
  if (candidates === null) return null;

  let items: unknown[] | null = null;
  if (Array.isArray(candidates)) {
    items = candidates;
  } else if (candidates && typeof candidates === "object") {
    const record = candidates as Record<string, unknown>;
    if (Array.isArray(record.entities)) items = record.entities;
    else if (Array.isArray(record.items)) items = record.items;
    else if (Array.isArray(record.redactions)) items = record.redactions;
    else if (Array.isArray(record.results)) items = record.results;
  }
  if (!items) return null;

  const output: ScrubEntityCandidate[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, 120)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const textValue =
      record.text ?? record.value ?? record.original ?? record.entity ?? record.substring;
    const categoryValue = record.category ?? record.type ?? record.label ?? record.entityType;
    const roleValue = record.role ?? record.semanticRole ?? record.semantic_role;
    if (typeof textValue !== "string") continue;
    const category = normalizeCategory(categoryValue);
    if (!category) continue;
    const role =
      typeof roleValue === "string" && /^[a-z][a-z0-9 _-]{0,38}$/i.test(roleValue.trim())
        ? roleValue.trim().toLowerCase()
        : undefined;
    pushCandidate(output, seen, textValue, category, role);
  }
  return output;
}

/** Strip fences, recover the first JSON object/array, and parse it. */
export function extractJsonValue(raw: string): unknown | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;

  const attempts: string[] = [body];
  const objectStart = body.indexOf("{");
  const objectEnd = body.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    attempts.push(body.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = body.indexOf("[");
  const arrayEnd = body.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    attempts.push(body.slice(arrayStart, arrayEnd + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Local heuristic extraction used by Simulation Mode and per-chunk fallback. */
export function heuristicEntities(
  text: string,
  documentType: DocumentType
): ScrubEntityCandidate[] {
  const output: ScrubEntityCandidate[] = [];
  const seen = new Set<string>();

  const labelPattern =
    /\b(Patient(?:\s+Name)?|Tenant|Landlord|Employer|Employee(?:\s+Name)?|Guarantor|Claimant|Insured|Insurer|Health Plan|For the Company|Prepared for|Prepared by|Attention|Attn\.?|Signed by|Name|Provider|Physician|Attending|Clinic|Hospital|Company)\s*[:\-]\s*([A-Z][A-Za-z.'’-]+(?:[ \t]+[A-Z][A-Za-z.'’-]+){0,3})/gi;
  collectMatches(text, labelPattern, 2, (value, match) => {
    const label = match[1].toLowerCase().replace(/\.$/, "");
    const mapping = LABEL_ROLE[label] ?? { category: "PERSON" as EntityCategory };
    pushCandidate(output, seen, value, mapping.category, mapping.role);
  });

  const orgPattern =
    /\b((?:[A-Z][A-Za-z&.'’-]+,?[ \t]+){1,5}(?:Hospital|Medical Center|Health System|Health Plan|Clinic|Properties|Property Management|Holdings|Realty|LLC|L\.L\.C\.|Inc\.?|Corporation|Corp\.?|Company|Group|Partners|Associates))\b/g;
  collectMatches(text, orgPattern, 1, (value) => {
    const lower = value.toLowerCase();
    let role: string | undefined = documentType === "medical_bill" ? "clinic" : undefined;
    if (/properties|realty|holdings/.test(lower) && documentType === "residential_lease") {
      role = "landlord";
    }
    if (documentType === "employment_contract") role = "employer";
    pushCandidate(output, seen, value, "ORG", role);
  });

  const addressPattern =
    /\b\d{1,6}\s+[A-Za-z0-9.'’-]+(?:[ \t]+[A-Za-z0-9.'’-]+){0,4}[ \t]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?)\b[^\n]{0,70}/gi;
  collectMatches(text, addressPattern, 0, (value) => {
    let clean = value;
    const zip = clean.match(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/);
    if (zip && zip.index !== undefined) {
      clean = clean.slice(0, zip.index + zip[0].length);
    } else {
      clean = clean.split(/\.\s/)[0];
    }
    pushCandidate(output, seen, clean, "ADDRESS");
  });

  const signaturePattern =
    /\b(?:Sincerely|Regards|Respectfully|Very truly yours)\s*,?\s*\n\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})/g;
  collectMatches(text, signaturePattern, 1, (value) => {
    pushCandidate(output, seen, value, "PERSON");
  });

  return output;
}

export function extractLineItems(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (items.length >= 30) break;
    const cptMatch = line.match(/\b(?:CPT|HCPCS)\s*[:#]?\s*([0-9]{5}|[A-Z][0-9]{4})\b/i);
    const bareMatch = line.match(/^\s*([0-9]{5})\s+\S/);
    const amountMatch = line.match(/\$([\d,]+(?:\.\d{2})?)/);
    const refCode = cptMatch?.[1] ?? (bareMatch && amountMatch ? bareMatch[1] : undefined);
    if (!refCode) continue;
    if (/^\s*NDC\b/i.test(line) && !cptMatch) continue;
    const description = line.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!description) continue;
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : undefined;
    items.push({
      refCode,
      description,
      ...(typeof amount === "number" && Number.isFinite(amount) ? { amount } : {}),
    });
  }
  return items;
}


/**
 * Replace candidate entities in one chunk while reusing tokens from the shared
 * registry. Longer candidates are replaced first so a full name wins over a
 * first name.
 */
export function applyCandidates(
  text: string,
  candidates: ScrubEntityCandidate[],
  registry: TokenRegistry,
  entities: LocalScrubEntity[],
  source: "device" | "regex"
): { text: string; applied: number } {
  let output = text;
  let applied = 0;
  const seenTokens = new Set(entities.map((entity) => entity.token));

  const ordered = [...candidates]
    .filter((candidate) => candidate.text.trim().length >= 2)
    .sort((a, b) => b.text.length - a.text.length);

  for (const candidate of ordered) {
    const needle = candidate.text.trim();
    if (!needle) continue;
    if (!output.toLowerCase().includes(needle.toLowerCase())) continue;
    const token = registry.register(needle, candidate.category);
    if (!token) continue;
    const next = replaceAllInsensitive(output, needle, token);
    if (next === output) continue;
    output = next;
    applied += 1;
    if (!seenTokens.has(token)) {
      seenTokens.add(token);
      entities.push({
        original: registry.tokenMap[token] ?? needle,
        category: candidate.category,
        token,
        ...(candidate.role ? { role: candidate.role } : {}),
        source,
      });
    }
  }

  return { text: output, applied };
}

function categoryFromPii(category: PiiCategory): EntityCategory {
  switch (category) {
    case "EMAIL":
    case "PHONE":
      return "CONTACT";
    case "DOB":
      return "DATE";
    case "CARD":
    case "BANK":
    case "POLICY":
      return "ACCOUNT";
    default:
      return "ID_NUMBER";
  }
}

export function addFirewallEntities(
  entities: LocalScrubEntity[],
  hits: FirewallHit[]
): LocalScrubEntity[] {
  const output = [...entities];
  const seen = new Set(output.map((entity) => entity.token));
  for (const hit of hits) {
    if (seen.has(hit.token)) continue;
    seen.add(hit.token);
    output.push({
      original: hit.original,
      category: categoryFromPii(hit.category),
      token: hit.token,
      source: "regex",
    });
  }
  return output;
}

export interface SimulationScrubOptions {
  documentType: DocumentType;
  maxChunkChars?: number;
  maxChunks?: number;
}

export interface SimulationScrubResult {
  entities: LocalScrubEntity[];
  sanitizedText: string;
  extractedItems: ExtractedItem[];
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
  chunks: number;
  truncated: boolean;
  firewallHits: FirewallHit[];
  rawBytes: number;
  warnings: string[];
}

/**
 * The complete deterministic pipeline: chunk → heuristic extraction →
 * deterministic tokens → regex firewall. Shared by Simulation Mode, per-chunk
 * fallback, and the security tests.
 */
export function scrubWithSimulation(
  rawText: string,
  options: SimulationScrubOptions
): SimulationScrubResult {
  const warnings: string[] = [];
  const entities: LocalScrubEntity[] = [];
  const registry = new TokenRegistry({}, rawText);
  const chunked = chunkText(rawText, {
    maxChars: options.maxChunkChars,
    maxChunks: options.maxChunks,
  });

  if (chunked.truncated) {
    warnings.push(
      `Document truncated to ${chunked.chunks.length} chunks. The tail was not analyzed.`
    );
  }

  const processed = chunked.chunks.map((chunk) => {
    const applied = applyCandidates(
      chunk.text,
      heuristicEntities(chunk.text, options.documentType),
      registry,
      entities,
      "regex"
    );
    return applied.text;
  });

  const assembled = processed.join("");
  const firewalled = runPiiFirewall(assembled, registry.snapshot());
  registry.absorb(firewalled);

  return {
    entities: addFirewallEntities(entities, firewalled.hits),
    sanitizedText: firewalled.text,
    extractedItems: extractLineItems(rawText),
    tokenMap: registry.tokenMap,
    reverseMap: registry.reverseMap,
    chunks: chunked.chunks.length,
    truncated: chunked.truncated,
    firewallHits: firewalled.hits,
    rawBytes: byteSize(rawText),
    warnings,
  };
}
