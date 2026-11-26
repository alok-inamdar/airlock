/**
 * Zero-PII audit persistence.
 *
 * Collection: users/{uid}/audits/{auditId}
 * Local fallback: localStorage (used when Firebase is not configured, or if a
 * Firestore write fails).
 *
 * The runtime guard rejects any record that contains raw document text, the
 * token map, entity originals, or residual direct identifiers.
 */

import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import type {
  AuditFinding,
  AuditReport,
  AuditSource,
  AuditStatus,
  AuditTelemetry,
  DocumentType,
} from "../types";
import { detectPii } from "../vault/piiFirewall";
import {
  assertWirePayload,
  scanWireForPii,
  WIRE_PAYLOAD_KEYS,
  type WirePayload,
} from "../vault/wireBoundary";
import { describeFirebaseError, ensureAnonymousAuth, getFirebaseRuntime } from "../ai/firebaseConfig";
import { logRequest } from "./telemetry";

export interface AuditRecord {
  auditId: string;
  documentType: DocumentType;
  jurisdiction: string;
  status: AuditStatus;
  wirePayload: WirePayload;
  rulePackVersion: string;
  overallRiskScore: number;
  estimatedSavings: number | null;
  findings: AuditFinding[];
  tokenizedDisputeDraft: string;
  telemetry: AuditTelemetry;
  summary?: string;
  source?: AuditSource;
  createdAt: number;
  updatedAt: number;
}

const LOCAL_KEY = "airlock.audits.v1";
const LOCAL_LIMIT = 40;

const ALLOWED_KEYS = new Set([
  "auditId",
  "documentType",
  "jurisdiction",
  "status",
  "wirePayload",
  "rulePackVersion",
  "overallRiskScore",
  "estimatedSavings",
  "findings",
  "tokenizedDisputeDraft",
  "telemetry",
  "summary",
  "source",
  "createdAt",
  "updatedAt",
]);

const FORBIDDEN_KEYS = ["rawDocumentText", "tokenMap", "reverseMap", "entities", "rawText", "letter"];

/** Throws if a record could leak raw document data to the cloud. */
export function assertZeroPiiAudit(record: AuditRecord): void {
  for (const key of FORBIDDEN_KEYS) {
    if (key in (record as unknown as Record<string, unknown>)) {
      throw new Error(`AUDIT_PII_VIOLATION: record contains forbidden field "${key}".`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`AUDIT_PII_VIOLATION: unexpected field "${key}".`);
    }
  }

  const wireKeys = Object.keys(record.wirePayload);
  if (
    wireKeys.length !== WIRE_PAYLOAD_KEYS.length ||
    wireKeys.some((key) => !WIRE_PAYLOAD_KEYS.includes(key as keyof WirePayload))
  ) {
    throw new Error("AUDIT_PII_VIOLATION: wirePayload has keys outside the allowlist.");
  }
  assertWirePayload(record.wirePayload);
  if (scanWireForPii(record.wirePayload).length > 0) {
    throw new Error("AUDIT_PII_VIOLATION: wirePayload still contains direct identifiers.");
  }

  const derivedText = [
    record.summary ?? "",
    record.tokenizedDisputeDraft,
    ...record.findings.flatMap((finding) => [
      finding.title,
      finding.explanation,
      finding.tokenizedEvidence ?? "",
    ]),
  ].join("\n");
  if (detectPii(derivedText).length > 0) {
    throw new Error("AUDIT_PII_VIOLATION: a derived field contains a direct identifier.");
  }
}

export function auditRecordFromReport(
  report: AuditReport,
  wire: WirePayload,
  telemetry: AuditTelemetry,
  status: AuditStatus
): AuditRecord {
  return {
    auditId: report.auditId,
    documentType: report.documentType,
    jurisdiction: report.jurisdiction,
    status,
    wirePayload: wire,
    rulePackVersion: report.rulePackVersion,
    overallRiskScore: report.overallRiskScore,
    estimatedSavings: report.estimatedSavings,
    findings: report.findings,
    tokenizedDisputeDraft: report.tokenizedDisputeDraft,
    telemetry,
    summary: report.summary,
    source: report.source,
    createdAt: report.createdAt,
    updatedAt: Date.now(),
  };
}

interface SaveResult {
  storage: "firestore" | "local";
  warning?: string;
}

function readLocal(): AuditRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record) => record && typeof record.auditId === "string");
  } catch {
    return [];
  }
}

function writeLocal(records: AuditRecord[]): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = records
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LOCAL_LIMIT);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed.slice(0, 8)));
    } catch {
      // Storage can be unavailable in private mode; the session keeps working.
    }
  }
}

function timestampToNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const candidate = value as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return Date.now();
}

function isWireShape(value: unknown): value is WirePayload {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return (
    keys.length === WIRE_PAYLOAD_KEYS.length &&
    keys.every((key) => WIRE_PAYLOAD_KEYS.includes(key as keyof WirePayload))
  );
}

function fromFirestore(auditId: string, data: Record<string, unknown>): AuditRecord | null {
  if (!isWireShape(data.wirePayload)) return null;
  const record: AuditRecord = {
    auditId,
    documentType: data.documentType as DocumentType,
    jurisdiction: String(data.jurisdiction ?? ""),
    status: (data.status as AuditStatus) ?? "audited_cloud",
    wirePayload: data.wirePayload,
    rulePackVersion: String(data.rulePackVersion ?? ""),
    overallRiskScore: Number(data.overallRiskScore ?? 0),
    estimatedSavings:
      typeof data.estimatedSavings === "number" ? data.estimatedSavings : null,
    findings: Array.isArray(data.findings) ? (data.findings as AuditFinding[]) : [],
    tokenizedDisputeDraft: String(data.tokenizedDisputeDraft ?? ""),
    telemetry: (data.telemetry as AuditTelemetry) ?? {
      piiEntitiesScrubbed: 0,
      regexCatches: 0,
      localLatencyMs: 0,
      cloudLatencyMs: 0,
      documentBytesSent: 0,
      rawDocumentBytes: 0,
      wirePayloadBytes: 0,
      localInferenceSource: "unknown",
      cloudInferenceSource: "unknown",
    },
    summary: typeof data.summary === "string" ? data.summary : undefined,
    source: (data.source as AuditSource) ?? undefined,
    createdAt: timestampToNumber(data.createdAt),
    updatedAt: timestampToNumber(data.updatedAt),
  };
  try {
    assertZeroPiiAudit(record);
    return record;
  } catch {
    return null;
  }
}

export async function saveAudit(record: AuditRecord): Promise<SaveResult> {
  assertZeroPiiAudit(record);

  const local = readLocal().filter((item) => item.auditId !== record.auditId);
  writeLocal([record, ...local]);

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const queued = record.status === "queued_offline";
  const runtime = getFirebaseRuntime();
  const uid = runtime
    ? runtime.auth.currentUser?.uid ?? (offline || queued ? null : await ensureAnonymousAuth())
    : null;
  if (!runtime || !uid) {
    const warning = runtime?.authError ?? undefined;
    logRequest({
      kind: "firestore",
      label: "Audit saved locally",
      detail: warning
        ? `localStorage fallback · ${warning}`
        : "localStorage fallback · zero-PII record",
      status: warning ? "error" : "ok",
    });
    return { storage: "local", ...(warning ? { warning } : {}) };
  }

  try {
    const payload = {
      ...record,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const write = setDoc(doc(runtime.db, "users", uid, "audits", record.auditId), payload);

    if (queued || offline) {
      // persistentLocalCache() resolves setDoc() only after the server acknowledges
      // the write. During an offline demo that never happens, so never await it:
      // the local copy is already saved, the UI returns, and the pending Firestore
      // write flushes when connectivity returns.
      void write
        .then(() => {
          logRequest({
            kind: "firestore",
            label: "Queued audit synced to Firestore",
            detail: `users/{uid}/audits/${record.auditId.slice(0, 18)}… · ${record.status}`,
            status: "ok",
          });
        })
        .catch((error) => {
          logRequest({
            kind: "firestore",
            label: "Queued audit Firestore write failed",
            detail: describeFirebaseError(error),
            status: "error",
          });
        });
      logRequest({
        kind: "firestore",
        label: "Audit queued locally",
        detail: "Firestore write pending — UI resolved from the persistent cache",
        status: "pending",
      });
      return { storage: "local" };
    }

    await write;
    logRequest({
      kind: "firestore",
      label: "Audit saved to Firestore",
      detail: `users/{uid}/audits/${record.auditId.slice(0, 18)}… · ${record.status}`,
      status: "ok",
    });
    return { storage: "firestore" };
  } catch (error) {
    const warning = describeFirebaseError(error);
    logRequest({
      kind: "firestore",
      label: "Firestore write failed — kept local copy",
      detail: warning,
      status: "error",
    });
    return { storage: "local", warning };
  }
}

export async function listAudits(): Promise<AuditRecord[]> {
  // Firestore getDocs() can wait on the server even with persistentLocalCache().
  // In an offline demo, resolve from the local copy immediately.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return readLocal();
  }
  const runtime = getFirebaseRuntime();
  const uid = runtime?.auth.currentUser?.uid;
  if (runtime && uid) {
    try {
      const snapshot = await getDocs(
        query(
          collection(runtime.db, "users", uid, "audits"),
          orderBy("updatedAt", "desc")
        )
      );
      const remote: AuditRecord[] = [];
      snapshot.forEach((item) => {
        const parsed = fromFirestore(item.id, item.data() as Record<string, unknown>);
        if (parsed) remote.push(parsed);
      });
      return remote;
    } catch (error) {
      logRequest({
        kind: "firestore",
        label: "Firestore list failed — using local audits",
        detail: describeFirebaseError(error),
        status: "error",
      });
    }
  }
  return readLocal();
}

export async function getAudit(auditId: string): Promise<AuditRecord | null> {
  const local = readLocal().find((item) => item.auditId === auditId);
  if (local) return local;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  const runtime = getFirebaseRuntime();
  const uid = runtime?.auth.currentUser?.uid;
  if (!runtime || !uid) return null;
  try {
    const snapshot = await getDoc(doc(runtime.db, "users", uid, "audits", auditId));
    if (!snapshot.exists()) return null;
    return fromFirestore(snapshot.id, snapshot.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function countAudits(): Promise<number> {
  return (await listAudits()).length;
}

export async function deleteAllAudits(): Promise<{ deleted: number; warning?: string }> {
  const deletedIds = new Set<string>();
  let warning: string | undefined;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const runtime = getFirebaseRuntime();
  const uid = runtime?.auth.currentUser?.uid;
  if (runtime && uid && !offline) {
    try {
      const snapshot = await getDocs(collection(runtime.db, "users", uid, "audits"));
      for (const item of snapshot.docs) deletedIds.add(item.id);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    } catch (error) {
      warning = describeFirebaseError(error);
    }
  }

  const local = readLocal();
  for (const record of local) deletedIds.add(record.auditId);
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }

  logRequest({
    kind: "firestore",
    label: "All audits deleted",
    detail: `${deletedIds.size} unique record(s) removed`,
    status: warning ? "error" : "ok",
  });

  return { deleted: deletedIds.size, ...(warning ? { warning } : {}) };
}

export async function updateAuditStatus(
  auditId: string,
  status: AuditStatus
): Promise<void> {
  const local = readLocal();
  const index = local.findIndex((item) => item.auditId === auditId);
  if (index !== -1) {
    const next = { ...local[index], status, updatedAt: Date.now() };
    local[index] = next;
    writeLocal(local);
    logRequest({
      kind: "firestore",
      label: "Local audit status updated",
      detail: `${auditId.slice(0, 18)}… → ${status}`,
      status: "ok",
    });
  }
}

export function queuedAuditsFrom(records: AuditRecord[]): AuditRecord[] {
  return records.filter((record) => record.status === "queued_offline");
}

export interface QueuedRunnerOptions {
  run: (record: AuditRecord) => Promise<void>;
  onError?: (record: AuditRecord, message: string) => void;
}

let runnerActive = false;

async function drainQueue(options: QueuedRunnerOptions): Promise<void> {
  if (runnerActive) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  runnerActive = true;
  try {
    const records = queuedAuditsFrom(await listAudits());
    for (const record of records) {
      try {
        await options.run(record);
      } catch (error) {
        options.onError?.(
          record,
          error instanceof Error ? error.message : "Queued audit retry failed."
        );
      }
    }
  } finally {
    runnerActive = false;
  }
}

/** App-level reconnect runner. Returns a cleanup function. */
export function startQueuedAuditRunner(options: QueuedRunnerOptions): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => {
    void drainQueue(options);
  };
  window.addEventListener("online", handler);
  const timer = navigator.onLine ? window.setTimeout(handler, 1200) : null;
  return () => {
    window.removeEventListener("online", handler);
    if (timer !== null) window.clearTimeout(timer);
  };
}

export async function retryQueuedAudits(options: QueuedRunnerOptions): Promise<number> {
  const records = queuedAuditsFrom(await listAudits());
  let processed = 0;
  for (const record of records) {
    try {
      await options.run(record);
      processed += 1;
    } catch (error) {
      options.onError?.(
        record,
        error instanceof Error ? error.message : "Queued audit retry failed."
      );
    }
  }
  return processed;
}
