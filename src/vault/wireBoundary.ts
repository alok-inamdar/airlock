/**
 * The strict type boundary between the local vault and the network.
 *
 * `LocalScrubResult` (raw originals, token map) never leaves the browser.
 * `WirePayload` is the only document shape accepted by the cloud auditor and
 * Firestore, and it is produced exclusively by `toWire()`.
 */

import type { DocumentType, ExtractedItem } from "../types";
import {
  detectPii,
  runPiiFirewall,
  type FirewallDetection,
  type FirewallHit,
} from "./piiFirewall";
import {
  replaceAllInsensitive,
  TokenRegistry,
  type EntityCategory,
} from "./tokenMap";

export interface LocalScrubEntity {
  original: string;
  category: EntityCategory;
  role?: string;
  token: string;
  source?: "device" | "regex" | "manual";
}

export interface LocalScrubResult {
  entities: LocalScrubEntity[];
  sanitizedText: string;
  extractedItems: ExtractedItem[];
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
}

export interface WirePayload {
  documentType: DocumentType;
  jurisdiction: string;
  sanitizedText: string;
  roleHints: Record<string, string>;
  extractedItems: ExtractedItem[];
}

export const WIRE_PAYLOAD_KEYS: Array<keyof WirePayload> = [
  "documentType",
  "jurisdiction",
  "sanitizedText",
  "roleHints",
  "extractedItems",
];

export interface WireBuildResult {
  wire: WirePayload;
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
  firewallHits: FirewallHit[];
  entityLeaksBlocked: number;
  passed: boolean;
  residual: FirewallDetection[];
}

const ALLOWED_ROLES = new Set([
  "patient",
  "tenant",
  "landlord",
  "property_manager",
  "employer",
  "employee",
  "executive",
  "guarantor",
  "claimant",
  "insured",
  "dependent",
  "spouse",
  "student",
  "clinic",
  "hospital",
  "insurer",
  "physician",
  "provider",
  "doctor",
  "nurse",
  "attorney",
  "lawyer",
  "billing",
  "agent",
  "customer",
  "vendor",
  "contractor",
]);

/** Role hints are optional metadata; only a fixed semantic vocabulary may cross. */
function sanitizeRole(role: string | undefined): string | undefined {
  if (!role) return undefined;
  const clean = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!clean || !ALLOWED_ROLES.has(clean)) return undefined;
  return clean;
}

function sweepEntities(
  text: string,
  entities: LocalScrubEntity[],
  registry: TokenRegistry
): { text: string; blocked: number } {
  let output = text;
  let blocked = 0;
  const ordered = [...entities]
    .filter((entity) => entity.original.trim().length >= 3)
    .sort((a, b) => b.original.length - a.original.length);

  for (const entity of ordered) {
    if (!output.toLowerCase().includes(entity.original.toLowerCase())) continue;
    const token = registry.register(entity.original, entity.category) ?? entity.token;
    const next = replaceAllInsensitive(output, entity.original, token);
    if (next !== output) {
      blocked += 1;
      output = next;
    }
  }
  return { text: output, blocked };
}

function sanitizeExtractedItems(
  items: ExtractedItem[],
  entities: LocalScrubEntity[],
  registry: TokenRegistry
): { items: ExtractedItem[]; hits: FirewallHit[] } {
  const hits: FirewallHit[] = [];
  const cleaned = items.slice(0, 40).map((item) => {
    const swept = sweepEntities(item.description, entities, registry);
    const firewalled = runPiiFirewall(swept.text, registry.snapshot());
    registry.absorb(firewalled);
    hits.push(...firewalled.hits);
    const refCode = item.refCode ? item.refCode.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 16) : undefined;
    const amount =
      typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount >= 0
        ? Math.round(item.amount * 100) / 100
        : undefined;
    return {
      ...(refCode ? { refCode } : {}),
      description: firewalled.text.slice(0, 260),
      ...(typeof amount === "number" ? { amount } : {}),
    };
  });
  return { items: cleaned, hits };
}

/**
 * Convert a local scrub result into a wire-safe payload. Runs the entity sweep
 * and the deterministic regex firewall again, immediately before serialization.
 */
export function toWire(
  local: LocalScrubResult,
  documentType: DocumentType,
  jurisdiction: string
): WireBuildResult {
  const registry = new TokenRegistry(
    { tokenMap: local.tokenMap, reverseMap: local.reverseMap },
    local.sanitizedText
  );

  const swept = sweepEntities(local.sanitizedText, local.entities, registry);
  const firewalled = runPiiFirewall(swept.text, registry.snapshot());
  registry.absorb(firewalled);

  const sanitizedItems = sanitizeExtractedItems(local.extractedItems, local.entities, registry);

  const roleHints: Record<string, string> = {};
  const originals = new Set(local.entities.map((entity) => entity.original.toLowerCase()));
  for (const entity of local.entities) {
    const role = sanitizeRole(entity.role);
    if (!role) continue;
    if (originals.has(role)) continue;
    if (!registry.tokenExists(entity.token)) continue;
    if (!roleHints[entity.token]) roleHints[entity.token] = role;
  }

  // Fixed key order matters: Pane 2 shows the literal serialized payload.
  const wire: WirePayload = {
    documentType,
    jurisdiction,
    sanitizedText: firewalled.text,
    roleHints,
    extractedItems: sanitizedItems.items,
  };

  const residual = scanWireForPii(wire);
  const tokenMap = registry.snapshot().tokenMap;
  const reverseMap = registry.snapshot().reverseMap;

  return {
    wire,
    tokenMap,
    reverseMap,
    firewallHits: [...firewalled.hits, ...sanitizedItems.hits],
    entityLeaksBlocked: swept.blocked,
    passed: residual.length === 0,
    residual,
  };
}

export function scanWireForPii(wire: WirePayload): FirewallDetection[] {
  const parts = [
    wire.sanitizedText,
    ...wire.extractedItems.map((item) => item.description),
    ...Object.values(wire.roleHints),
  ];
  return detectPii(parts.join("\n"));
}

/** Runtime guard used before any network call and before every persistence. */
export function assertWirePayload(wire: WirePayload): void {
  const keys = Object.keys(wire).sort();
  const expected = [...WIRE_PAYLOAD_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("WIRE_BOUNDARY_VIOLATION: payload contains keys outside the allowlist.");
  }
  const residual = scanWireForPii(wire);
  if (residual.length > 0) {
    throw new Error(
      `WIRE_BOUNDARY_VIOLATION: ${residual.length} direct identifier(s) survived the firewall.`
    );
  }
}

export function wireByteSize(wire: WirePayload): number {
  return new TextEncoder().encode(JSON.stringify(wire)).length;
}

export function byteSize(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function payloadReductionPercent(rawBytes: number, wireBytes: number): number {
  if (rawBytes <= 0) return 0;
  const reduction = 1 - wireBytes / rawBytes;
  return Math.max(0, Math.min(100, Math.round(reduction * 100)));
}
