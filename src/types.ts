/** Shared domain types for the Airlock pipeline. */

export type DocumentType = "medical_bill" | "residential_lease" | "employment_contract";

export const DOCUMENT_TYPES: DocumentType[] = [
  "medical_bill",
  "residential_lease",
  "employment_contract",
];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  medical_bill: "Medical Bill",
  residential_lease: "Residential Lease",
  employment_contract: "Employment Contract",
};

export const DOCUMENT_TYPE_SHORT: Record<DocumentType, string> = {
  medical_bill: "Medical",
  residential_lease: "Lease",
  employment_contract: "Employment",
};

export type JurisdictionValue = "California, US" | "New York City, US";

export interface JurisdictionOption {
  value: JurisdictionValue;
  short: string;
  rulePackId: "ca-2026" | "nyc-2026" | null;
}

export const JURISDICTIONS: JurisdictionOption[] = [
  { value: "California, US", short: "California", rulePackId: "ca-2026" },
  { value: "New York City, US", short: "New York City", rulePackId: "nyc-2026" },
];

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface ExtractedItem {
  refCode?: string;
  description: string;
  amount?: number;
}

export interface AuditFinding {
  id: string;
  title: string;
  severity: Severity;
  explanation: string;
  estimatedImpact: number | null;
  matchedRuleId: string;
  matchedRuleTitle?: string;
  citation?: string;
  citationUrl?: string;
  tokenizedEvidence?: string;
  confidence?: "high" | "medium" | "low";
  flaggedAsPotential?: boolean;
}

export type AuditSource = "cloud" | "cached_demo" | "local_triage";

export interface AuditReport {
  auditId: string;
  documentType: DocumentType;
  jurisdiction: string;
  createdAt: number;
  overallRiskScore: number;
  estimatedSavings: number | null;
  summary: string;
  findings: AuditFinding[];
  tokenizedDisputeDraft: string;
  rulePackVersion: string;
  rulePackIds: string[];
  source: AuditSource;
  cloudModel?: string;
  cloudInferenceSource?: string;
  droppedCitations: string[];
  latencyMs: number;
  warnings: string[];
}

export type AuditStatus = "scrubbed_local" | "queued_offline" | "audited_cloud" | "resolved";

export type Tone = "formal" | "collaborative" | "escalation";

export const TONES: Array<{ value: Tone; label: string; description: string }> = [
  {
    value: "formal",
    label: "Firm & Formal",
    description: "Neutral, documented, deadline-driven.",
  },
  {
    value: "collaborative",
    label: "Collaborative",
    description: "Seeks a fast, good-faith resolution.",
  },
  {
    value: "escalation",
    label: "Legal Escalation",
    description: "Notice of intent to pursue remedies.",
  },
];

export interface AuditTelemetry {
  piiEntitiesScrubbed: number;
  regexCatches: number;
  localLatencyMs: number;
  cloudLatencyMs: number;
  documentBytesSent: number;
  rawDocumentBytes: number;
  wirePayloadBytes: number;
  localInferenceSource: string;
  cloudInferenceSource: string;
}

export interface LetterState {
  tokenized: string;
  final: string;
  tone: Tone;
  polished: boolean;
  warnings: string[];
}

export interface DocumentInput {
  text: string;
  documentType: DocumentType;
  jurisdiction: JurisdictionValue;
  label: string;
  sampleId?: string;
}

export type FirebaseStatus = "disabled" | "initializing" | "ready" | "error";
