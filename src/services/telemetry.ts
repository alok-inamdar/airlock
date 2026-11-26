/**
 * A tiny in-memory request log. No analytics, no network, no persistence.
 * The Airlock X-Ray shows these entries so judges can classify every request.
 */

export type RequestKind =
  | "auth"
  | "app_check"
  | "remote_config"
  | "firestore"
  | "ai_on_device"
  | "ai_cloud"
  | "document_payload"
  | "pdf_parse"
  | "vault";

export type RequestStatus = "ok" | "pending" | "error" | "blocked";

export interface RequestLogEntry {
  id: string;
  at: number;
  kind: RequestKind;
  label: string;
  detail?: string;
  bytes?: number;
  durationMs?: number;
  status: RequestStatus;
}

export type RequestLogInput = Omit<RequestLogEntry, "id" | "at">;

let counter = 0;

class TelemetryLog {
  private entries: RequestLogEntry[] = [];
  private listeners = new Set<() => void>();

  add(input: RequestLogInput): RequestLogEntry {
    counter += 1;
    const entry: RequestLogEntry = {
      ...input,
      id: `req_${counter.toString(36)}`,
      at: Date.now(),
    };
    this.entries = [entry, ...this.entries].slice(0, 80);
    this.emit();
    return entry;
  }

  list(): RequestLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RequestLogEntry[] => this.entries;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const telemetry = new TelemetryLog();

export function logRequest(input: RequestLogInput): RequestLogEntry {
  return telemetry.add(input);
}

export function documentBytesSent(): number {
  return telemetry
    .list()
    .filter((entry) => entry.kind === "document_payload")
    .reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
}

export function classifyRequest(entry: RequestLogEntry): "infrastructure" | "document" | "local" {
  if (entry.kind === "document_payload" || entry.kind === "ai_cloud") return "document";
  if (entry.kind === "ai_on_device" || entry.kind === "vault" || entry.kind === "pdf_parse") {
    return "local";
  }
  return "infrastructure";
}

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  auth: "Firebase Auth",
  app_check: "App Check",
  remote_config: "Remote Config",
  firestore: "Firestore",
  ai_on_device: "On-device AI",
  ai_cloud: "Cloud AI",
  document_payload: "Document payload",
  pdf_parse: "PDF parser",
  vault: "Local vault",
};
