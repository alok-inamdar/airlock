/**
 * Ephemeral local vault.
 *
 * Raw document text and the token map live in memory and, for reload
 * resilience within the same tab session, in sessionStorage. Nothing here is
 * ever written to localStorage, IndexedDB, or Firestore. "Wipe Local Vault"
 * clears both copies.
 */

import type { DocumentType } from "../types";
import { logRequest } from "../services/telemetry";

export interface LocalVaultEntry {
  auditId: string;
  createdAt: number;
  documentType: DocumentType;
  jurisdiction: string;
  rawDocumentText: string;
  tokenMap: Record<string, string>;
  reverseMap: Record<string, string>;
  rehydratedLetter?: string;
}

const VAULT_KEY = "airlock.vault.v1";

let cache: Map<string, LocalVaultEntry> | null = null;
let lastPersistenceError: string | null = null;

function readStorage(): Map<string, LocalVaultEntry> {
  if (typeof sessionStorage === "undefined") return new Map();
  try {
    const raw = sessionStorage.getItem(VAULT_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as LocalVaultEntry[];
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed
        .filter((entry) => entry && typeof entry.auditId === "string")
        .map((entry) => [entry.auditId, entry])
    );
  } catch {
    return new Map();
  }
}

function ensureCache(): Map<string, LocalVaultEntry> {
  if (!cache) cache = readStorage();
  return cache;
}

function persist(entries: Map<string, LocalVaultEntry>): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem(VAULT_KEY, JSON.stringify([...entries.values()]));
    lastPersistenceError = null;
    return true;
  } catch (error) {
    lastPersistenceError =
      error instanceof Error ? error.message : "Session storage rejected the vault.";
    return false;
  }
}

export function saveVaultEntry(
  entry: LocalVaultEntry
): { persisted: boolean; error: string | null } {
  const entries = ensureCache();
  entries.set(entry.auditId, entry);
  const persisted = persist(entries);
  logRequest({
    kind: "vault",
    label: "Local vault entry saved",
    detail: persisted
      ? "sessionStorage · raw text + token map stay in this browser"
      : "memory only · sessionStorage quota unavailable",
    bytes: estimateBytes(entry.rawDocumentText),
    status: persisted ? "ok" : "error",
  });
  return { persisted, error: lastPersistenceError };
}

export function getVaultEntry(auditId: string): LocalVaultEntry | null {
  return ensureCache().get(auditId) ?? null;
}

export function updateVaultEntry(
  auditId: string,
  patch: Partial<LocalVaultEntry>
): LocalVaultEntry | null {
  const entries = ensureCache();
  const existing = entries.get(auditId);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  entries.set(auditId, next);
  persist(entries);
  return next;
}

export function listVaultEntries(): LocalVaultEntry[] {
  return [...ensureCache().values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function removeVaultEntry(auditId: string): boolean {
  const entries = ensureCache();
  const existed = entries.delete(auditId);
  if (existed) persist(entries);
  return existed;
}

export function wipeVault(): { removed: number } {
  const removed = ensureCache().size;
  cache = new Map();
  try {
    sessionStorage.removeItem(VAULT_KEY);
  } catch {
    // ignore
  }
  logRequest({
    kind: "vault",
    label: "Local vault wiped",
    detail: `${removed} entr${removed === 1 ? "y" : "ies"} removed from memory and sessionStorage`,
    status: "ok",
  });
  return { removed };
}

export function vaultStats(): { entries: number; bytes: number; persistenceError: string | null } {
  const entries = [...ensureCache().values()];
  const bytes = entries.reduce(
    (sum, entry) => sum + estimateBytes(entry.rawDocumentText) + estimateBytes(JSON.stringify(entry.tokenMap)),
    0
  );
  return { entries: entries.length, bytes, persistenceError: lastPersistenceError };
}

export function estimateBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
