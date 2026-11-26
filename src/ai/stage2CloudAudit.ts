/**
 * Stage 2: cloud rule-backed audit over the WirePayload only.
 *
 * - InferenceMode.ONLY_IN_CLOUD
 * - native Structured JSON Output (responseMimeType + responseSchema)
 * - bundled 2026 Rule Packs, no Google Search Grounding
 * - 25s timeout, one retry with gemini-3.5-flash-lite
 * - citation allowlist by matchedRuleId; unknown IDs are dropped
 * - clearly labeled cached demo fallback when cloud is unavailable
 */

import { Schema } from "firebase/ai";
import type { AuditFinding, AuditReport, Severity } from "../types";
import {
  getRulePack,
  getRulePackIdsFor,
  getRulePackVersionFor,
  resolveVerifiedCitation,
  type Rule,
  type RulePack,
} from "../rules/rulePacks2026";
import { detectPii } from "../vault/piiFirewall";
import { TOKEN_SCAN } from "../vault/rehydrate";
import { assertWirePayload, byteSize, type WirePayload } from "../vault/wireBoundary";
import { firebaseEnabled } from "./firebaseConfig";
import {
  extractResponseText,
  getCloudAuditorModel,
  getHybridTriageModel,
  readInferenceSource,
} from "./modelFactory";
import { buildCachedDemoAudit, buildTokenizedDraft } from "../samples/demoAudit";
import { buildCloudAuditPrompt, buildTriagePrompt, detectPromptInjection } from "./prompts";
import { extractJsonValue } from "./simulationScrub";
import { createId } from "../lib/ids";
import { logRequest } from "../services/telemetry";
import { isLocalNanoReady } from "./modelFactory";

export const PRIMARY_CLOUD_MODEL = "gemini-4-hydrogen";
export const FALLBACK_CLOUD_MODEL = "gemini-3.5-flash-lite";
export const CLOUD_TIMEOUT_MS = 25_000;
const TRIAGE_TIMEOUT_MS = 12_000;
const MAX_FINDINGS = 12;

export type CloudErrorKind =
  | "app_check"
  | "rate_limit"
  | "timeout"
  | "offline"
  | "config"
  | "invalid_response"
  | "unknown";

export class CloudAuditError extends Error {
  readonly kind: CloudErrorKind;
  readonly hint: string;

  constructor(kind: CloudErrorKind, message: string) {
    super(message);
    this.name = "CloudAuditError";
    this.kind = kind;
    this.hint = hintFor(kind);
  }
}

function hintFor(kind: CloudErrorKind): string {
  switch (kind) {
    case "app_check":
      return "App Check rejected the request. Disable ad blockers/privacy extensions for this site, reload, or use the cached demo result.";
    case "rate_limit":
      return "The free-tier Gemini quota was hit. Wait a minute and retry, or use the cached demo result.";
    case "timeout":
      return "The cloud audit exceeded its 25-second budget. Retry, or use the cached demo result.";
    case "offline":
      return "Airlock could not reach the network. You can queue the audit locally and retry when online.";
    case "config":
      return "Firebase AI Logic is not configured correctly. Check the environment variables and enable AI Logic in the Firebase console.";
    case "invalid_response":
      return "The model returned JSON that did not match the audit schema. The cached demo result is available.";
    default:
      return "The cloud audit failed. Retry once, then use the cached demo result if the issue persists.";
  }
}

function classifyCloudError(error: unknown): CloudAuditError {
  if (error instanceof CloudAuditError) return error;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  if (/app[-_ ]?check|appcheck|recaptcha|\b403\b|permission[-_ ]denied/i.test(message)) {
    return new CloudAuditError("app_check", message);
  }
  if (/429|resource[-_ ]exhausted|quota|rate limit|too many requests/i.test(message)) {
    return new CloudAuditError("rate_limit", message);
  }
  if (/abort|timeout|deadline/i.test(message)) {
    return new CloudAuditError("timeout", message);
  }
  if (/offline|failed to fetch|network[-_ ]request[-_ ]failed|networkerror/i.test(message)) {
    return new CloudAuditError("offline", message);
  }
  if (/FIREBASE_DISABLED|FIREBASE_NOT_READY|api[-_ ]?not[-_ ]?enabled|no[-_ ]app[-_ ]id/i.test(message)) {
    return new CloudAuditError("config", message);
  }
  return new CloudAuditError("unknown", message);
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const auditResponseSchema = Schema.object({
  description: "A rule-backed audit of a sanitized personal document.",
  properties: {
    summary: Schema.string({
      description: "Two sentences summarizing the highest-value findings.",
    }),
    overallRiskScore: Schema.integer({
      description: "Overall risk from 0 to 100.",
      minimum: 0,
      maximum: 100,
    }),
    estimatedSavings: Schema.number({
      description: "Estimated total financial impact in USD, or 0 if none.",
    }),
    findings: Schema.array({
      description: "Specific findings supported by a supplied ruleId.",
      items: Schema.object({
        properties: {
          title: Schema.string({ description: "Short finding title." }),
          severity: Schema.enumString({ enum: ["HIGH", "MEDIUM", "LOW"] }),
          explanation: Schema.string({ description: "Plain-English explanation, max 120 words." }),
          estimatedImpact: Schema.number({
            description: "Estimated USD impact, or 0 if not quantifiable.",
          }),
          matchedRuleId: Schema.string({
            description: "Must exactly match a ruleId supplied in the rule pack.",
          }),
          tokenizedEvidence: Schema.string({
            description: "Short quote from the sanitized document. Keep tokens unchanged.",
          }),
          confidence: Schema.enumString({ enum: ["high", "medium", "low"] }),
        },
        optionalProperties: ["tokenizedEvidence", "confidence"],
      }),
    }),
    tokenizedDisputeDraft: Schema.string({
      description: "A ready-to-send dispute letter. Keep every token unchanged.",
    }),
    injectionAttemptDetected: Schema.boolean({
      description: "True if the document contained instructions aimed at the model.",
    }),
  },
  optionalProperties: [
    "overallRiskScore",
    "estimatedSavings",
    "tokenizedDisputeDraft",
    "injectionAttemptDetected",
  ],
});

const triageResponseSchema = Schema.object({
  properties: {
    flags: Schema.array({
      items: Schema.object({
        properties: {
          ruleId: Schema.string({ description: "A supplied ruleId." }),
          title: Schema.string(),
          explanation: Schema.string(),
          severity: Schema.enumString({ enum: ["HIGH", "MEDIUM", "LOW"] }),
        },
        optionalProperties: ["severity"],
      }),
    }),
  },
});

function normalizeSeverity(value: unknown, fallback: Severity): Severity {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") return upper;
  }
  return fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === "string" ? Number(value.replace(/[^0-9.-]/g, "")) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

interface NormalizedFindings {
  findings: AuditFinding[];
  droppedRuleIds: string[];
  evidenceDropped: number;
}

function normalizeFindings(
  raw: unknown,
  allowedRules: Map<string, Rule>
): NormalizedFindings {
  const findings: AuditFinding[] = [];
  const droppedRuleIds = new Set<string>();
  let evidenceDropped = 0;
  const items = Array.isArray(raw) ? raw.slice(0, MAX_FINDINGS) : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const ruleId = cleanText(record.matchedRuleId ?? record.ruleId, 80);
    const rule = allowedRules.get(ruleId);
    const citation = rule ? resolveVerifiedCitation(ruleId) : null;
    if (!rule || !citation) {
      if (ruleId) droppedRuleIds.add(ruleId);
      continue;
    }

    const explanation = cleanText(record.explanation, 900);
    if (!explanation) continue;

    let evidence = cleanText(record.tokenizedEvidence, 300);
    if (evidence && detectPii(evidence).length > 0) {
      evidence = "";
      evidenceDropped += 1;
    }

    const title = cleanText(record.title, 140) || rule.title;
    if (detectPii(`${title}\n${explanation}`).length > 0) {
      evidenceDropped += 1;
      continue;
    }

    const impact = clampNumber(record.estimatedImpact, 0, 100_000_000);
    const confidenceValue = cleanText(record.confidence, 10).toLowerCase();

    findings.push({
      id: createId("finding"),
      title,
      severity: normalizeSeverity(record.severity, rule.severityHint),
      explanation,
      estimatedImpact: impact && impact > 0 ? Math.round(impact * 100) / 100 : null,
      matchedRuleId: citation.ruleId,
      matchedRuleTitle: citation.title,
      citation: citation.citation,
      citationUrl: citation.url,
      ...(evidence ? { tokenizedEvidence: evidence } : {}),
      confidence:
        confidenceValue === "high" || confidenceValue === "medium" || confidenceValue === "low"
          ? confidenceValue
          : "medium",
      flaggedAsPotential: rule.potential,
    });
  }

  return { findings, droppedRuleIds: [...droppedRuleIds], evidenceDropped };
}

function riskFromFindings(findings: AuditFinding[]): number {
  const score = findings.reduce((sum, finding) => {
    if (finding.severity === "HIGH") return sum + 34;
    if (finding.severity === "MEDIUM") return sum + 16;
    return sum + 6;
  }, 0);
  return Math.min(100, score);
}

function buildReportFromModelText(
  text: string,
  wire: WirePayload,
  packs: RulePack[],
  modelName: string,
  inferenceSource: string,
  latencyMs: number,
  auditId: string
): AuditReport {
  const parsed = extractJsonValue(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CloudAuditError("invalid_response", "Cloud audit returned non-JSON content.");
  }
  const record = parsed as Record<string, unknown>;
  const allowedRules = new Map<string, Rule>();
  for (const pack of packs) {
    for (const rule of pack.rules) allowedRules.set(rule.ruleId, rule);
  }

  const normalized = normalizeFindings(record.findings, allowedRules);
  const warnings: string[] = [];
  if (normalized.droppedRuleIds.length > 0) {
    warnings.push(
      `${normalized.droppedRuleIds.length} finding(s) cited rule IDs outside the verified pack and were dropped.`
    );
  }
  if (normalized.evidenceDropped > 0) {
    warnings.push("Model output containing residual identifiers was removed.");
  }
  if (record.injectionAttemptDetected === true || detectPromptInjection(wire.sanitizedText)) {
    warnings.push(
      "Prompt-injection language was detected inside the document and treated strictly as data."
    );
  }

  const summed = normalized.findings.reduce(
    (sum, finding) => sum + (finding.estimatedImpact ?? 0),
    0
  );
  const modelSavings = clampNumber(record.estimatedSavings, 0, 100_000_000);
  const savings = Math.max(modelSavings ?? 0, summed);
  const score = clampNumber(record.overallRiskScore ?? record.riskScore, 0, 100);
  let draft = typeof record.tokenizedDisputeDraft === "string"
    ? record.tokenizedDisputeDraft.trim().slice(0, 12_000)
    : "";
  if (draft && detectPii(draft).length > 0) {
    warnings.push("The cloud draft contained residual identifiers and was replaced with a local template.");
    draft = "";
  }
  if (draft) {
    const knownTokens = new Set([
      ...(wire.sanitizedText.match(TOKEN_SCAN) ?? []),
      ...Object.keys(wire.roleHints),
    ]);
    const unknownTokens = (draft.match(TOKEN_SCAN) ?? []).filter(
      (token) => !knownTokens.has(token)
    );
    if (unknownTokens.length > 0) {
      warnings.push(
        `The cloud draft referenced ${unknownTokens.length} token(s) that do not exist in the local vault; the local template was used.`
      );
      draft = "";
    }
  }
  if (!draft) draft = buildTokenizedDraft(wire, normalized.findings);

  let summary = cleanText(record.summary, 700);
  if (summary && detectPii(summary).length > 0) {
    warnings.push("The cloud summary contained residual identifiers and was replaced.");
    summary = "";
  }
  if (!summary) {
    summary =
      normalized.findings.length > 0
        ? `The audit found ${normalized.findings.length} issue(s) supported by the bundled 2026 Rule Packs.`
        : "The audit found no specific violation supported by the bundled 2026 Rule Packs.";
  }

  return {
    auditId,
    documentType: wire.documentType,
    jurisdiction: wire.jurisdiction,
    createdAt: Date.now(),
    overallRiskScore: score ?? riskFromFindings(normalized.findings),
    estimatedSavings: savings > 0 ? Math.round(savings * 100) / 100 : null,
    summary,
    findings: normalized.findings,
    tokenizedDisputeDraft: draft,
    rulePackVersion: getRulePackVersionFor(wire.jurisdiction, wire.documentType),
    rulePackIds: getRulePackIdsFor(wire.jurisdiction, wire.documentType),
    source: "cloud",
    cloudModel: modelName,
    cloudInferenceSource: inferenceSource,
    droppedCitations: normalized.droppedRuleIds,
    latencyMs,
    warnings,
  };
}

export interface CloudAuditOptions {
  auditId?: string;
  modelName?: string;
  timeoutMs?: number;
}

/**
 * Run the cloud audit. Never accepts raw text: the WirePayload type and a
 * runtime assertion enforce the boundary immediately before the request.
 */
export async function runCloudAudit(
  wire: WirePayload,
  options: CloudAuditOptions = {}
): Promise<AuditReport> {
  assertWirePayload(wire);

  if (!firebaseEnabled) {
    return buildCachedDemoAudit(wire, {
      auditId: options.auditId,
      reason: "Firebase is not configured, so Airlock is running in Local Demo Mode.",
    });
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return buildCachedDemoAudit(wire, {
      auditId: options.auditId,
      reason: "The browser reports that it is offline.",
    });
  }

  const packs = getRulePack(wire.jurisdiction, wire.documentType);
  if (packs.length === 0) {
    return buildCachedDemoAudit(wire, {
      auditId: options.auditId,
      reason: "No rule pack is bundled for this jurisdiction and document type.",
    });
  }

  const primary =
    options.modelName === PRIMARY_CLOUD_MODEL || options.modelName === FALLBACK_CLOUD_MODEL
      ? options.modelName
      : PRIMARY_CLOUD_MODEL;
  const models = primary === FALLBACK_CLOUD_MODEL
    ? [FALLBACK_CLOUD_MODEL, FALLBACK_CLOUD_MODEL]
    : [PRIMARY_CLOUD_MODEL, FALLBACK_CLOUD_MODEL];
  const timeoutMs = options.timeoutMs ?? CLOUD_TIMEOUT_MS;
  const prompt = buildCloudAuditPrompt(wire, packs);
  const payloadBytes = byteSize(JSON.stringify(wire));
  const started = Date.now();
  let lastError: CloudAuditError | null = null;

  for (let attempt = 0; attempt < models.length; attempt += 1) {
    const modelName = models[attempt];
    const attemptStarted = Date.now();
    logRequest({
      kind: "document_payload",
      label: `WirePayload → Cloud Gemini (${modelName})`,
      detail: `attempt ${attempt + 1} of ${models.length} · schema-locked · zero detected direct identifiers`,
      bytes: payloadBytes,
      status: "ok",
    });

    try {
      const model = getCloudAuditorModel(auditResponseSchema, modelName);
      const result = await withTimeout(
        (signal) => model.generateContent(prompt, { signal }),
        timeoutMs
      );
      const inferenceSource = readInferenceSource(result);
      const report = buildReportFromModelText(
        extractResponseText(result),
        wire,
        packs,
        modelName,
        inferenceSource,
        Date.now() - started,
        options.auditId ?? createId("audit")
      );
      logRequest({
        kind: "ai_cloud",
        label: `Cloud Gemini audit (${modelName})`,
        detail: `${report.findings.length} findings · source ${inferenceSource}`,
        durationMs: Date.now() - attemptStarted,
        status: "ok",
      });
      return report;
    } catch (error) {
      lastError = classifyCloudError(error);
      logRequest({
        kind: "ai_cloud",
        label: `Cloud Gemini audit failed (${modelName})`,
        detail: lastError.message,
        durationMs: Date.now() - attemptStarted,
        status: "error",
      });
    }
  }

  throw (
    lastError ??
    new CloudAuditError("unknown", "Cloud audit failed without a specific error.")
  );
}

function deterministicTriage(wire: WirePayload, packs: RulePack[]): AuditFinding[] {
  const lower = wire.sanitizedText.toLowerCase();
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();

  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (findings.length >= 6) break;
      if (seen.has(rule.ruleId)) continue;
      const hit = rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
      if (!hit) continue;
      const citation = resolveVerifiedCitation(rule.ruleId);
      if (!citation) continue;
      seen.add(rule.ruleId);
      const explanation =
        rule.summary.length > 420 ? `${rule.summary.slice(0, 417)}…` : rule.summary;
      findings.push({
        id: createId("triage"),
        title: rule.title,
        severity: rule.severityHint,
        explanation,
        estimatedImpact: null,
        matchedRuleId: citation.ruleId,
        matchedRuleTitle: citation.title,
        citation: citation.citation,
        citationUrl: citation.url,
        confidence: "low",
        flaggedAsPotential: true,
      });
    }
  }
  return findings;
}

export async function runOfflineTriage(wire: WirePayload): Promise<AuditReport> {
  assertWirePayload(wire);
  const packs = getRulePack(wire.jurisdiction, wire.documentType);
  const started = Date.now();
  let findings: AuditFinding[] = [];
  let source = "none";
  let model = "deterministic-keywords";
  const warnings: string[] = [
    "On-device triage is a shortlist, not a full audit. The sanitized payload is queued for a cloud audit.",
  ];

  const canUseHybrid = firebaseEnabled && (await isLocalNanoReady());
  if (canUseHybrid && packs.length > 0) {
    try {
      const modelInstance = getHybridTriageModel(FALLBACK_CLOUD_MODEL, triageResponseSchema);
      const result = await withTimeout(
        (signal) =>
          modelInstance.generateContent(buildTriagePrompt(wire, packs), { signal }),
        TRIAGE_TIMEOUT_MS
      );
      source = readInferenceSource(result);
      model = `hybrid:${FALLBACK_CLOUD_MODEL}`;
      const parsed = extractJsonValue(extractResponseText(result));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const allowed = new Map<string, Rule>();
        for (const pack of packs) for (const rule of pack.rules) allowed.set(rule.ruleId, rule);
        const normalized = normalizeFindings(record.flags, allowed);
        findings = normalized.findings.map((finding) => ({
          ...finding,
          confidence: "low",
          flaggedAsPotential: true,
          estimatedImpact: null,
        }));
        if (normalized.droppedRuleIds.length > 0) {
          warnings.push("Hybrid triage cited unknown rule IDs; those flags were dropped.");
        }
      }
    } catch (error) {
      const classified = classifyCloudError(error);
      warnings.push(`Hybrid triage failed (${classified.kind}); used deterministic keyword triage.`);
    }
  }

  if (findings.length === 0) {
    findings = deterministicTriage(wire, packs);
  }

  logRequest({
    kind: "ai_on_device",
    label: "Local triage on sanitized payload",
    detail: `${findings.length} red flags · ${source === "none" ? "deterministic keywords" : `source ${source}`}`,
    durationMs: Date.now() - started,
    status: "ok",
  });

  const estimated = findings.reduce((sum, finding) => sum + (finding.estimatedImpact ?? 0), 0);

  return {
    auditId: createId("audit"),
    documentType: wire.documentType,
    jurisdiction: wire.jurisdiction,
    createdAt: Date.now(),
    overallRiskScore: riskFromFindings(findings),
    estimatedSavings: estimated > 0 ? estimated : null,
    summary:
      "On-device triage only. Airlock scrubbed the document locally and matched the sanitized payload against the bundled Rule Packs. The full cloud audit is queued.",
    findings,
    tokenizedDisputeDraft: buildTokenizedDraft(wire, findings),
    rulePackVersion: getRulePackVersionFor(wire.jurisdiction, wire.documentType),
    rulePackIds: getRulePackIdsFor(wire.jurisdiction, wire.documentType),
    source: "local_triage",
    cloudModel: model,
    cloudInferenceSource: source,
    droppedCitations: [],
    latencyMs: Date.now() - started,
    warnings,
  };
}
