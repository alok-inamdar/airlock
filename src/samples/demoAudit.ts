/**
 * Clearly labeled cached demo audit.
 *
 * Used when Firebase is not configured, when the browser is offline, when the
 * free-tier quota is exhausted, or when App Check blocks the request. Findings
 * cite only bundled rule IDs; tokenized drafts keep the wire tokens intact.
 */

import type { AuditFinding, AuditReport, DocumentType, Severity } from "../types";
import {
  getRuleByIdWithPack,
  getRulePackIdsFor,
  getRulePackVersionFor,
} from "../rules/rulePacks2026";
import type { WirePayload } from "../vault/wireBoundary";
import { createId } from "../lib/ids";

interface CachedDemoOptions {
  auditId?: string;
  reason?: string;
}

interface FindingOverride {
  title?: string;
  explanation: string;
  severity?: Severity;
  estimatedImpact?: number | null;
  tokenizedEvidence?: string;
  confidence?: "high" | "medium" | "low";
  flaggedAsPotential?: boolean;
}

function finding(ruleId: string, override: FindingOverride, index: number): AuditFinding | null {
  const found = getRuleByIdWithPack(ruleId);
  if (!found) return null;
  return {
    id: `demo-${index}-${ruleId.toLowerCase()}`,
    title: override.title ?? found.rule.title,
    severity: override.severity ?? found.rule.severityHint,
    explanation: override.explanation,
    estimatedImpact: override.estimatedImpact ?? null,
    matchedRuleId: found.rule.ruleId,
    matchedRuleTitle: found.rule.title,
    citation: found.rule.citation,
    citationUrl: found.rule.url,
    tokenizedEvidence: override.tokenizedEvidence,
    confidence: override.confidence ?? "high",
    flaggedAsPotential: override.flaggedAsPotential ?? found.rule.potential,
  };
}

function amountForLine(text: string, test: (line: string) => boolean): number | null {
  for (const line of text.split(/\r?\n/)) {
    if (!test(line)) continue;
    const match = line.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function codeLines(text: string, code: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => new RegExp(`\\b${code}\\b`).test(line));
}

function findRoleToken(roleHints: Record<string, string>, roles: string[]): string | null {
  for (const role of roles) {
    const match = Object.entries(roleHints).find(([, hint]) => hint === role);
    if (match) return match[0];
  }
  return null;
}

function buildMedicalFindings(wire: WirePayload): AuditFinding[] {
  const text = wire.sanitizedText;
  const findings: AuditFinding[] = [];
  const erLines = codeLines(text, "99284");
  const erCharge = amountForLine(text, (line) => /\b99284\b/.test(line));

  if (erLines.length >= 2 && erCharge) {
    const item = finding(
      "CMS-DUPLICATE-CLAIM",
      {
        title: "Duplicate ER facility fee (CPT 99284)",
        explanation:
          "The same level-4 emergency department code appears on more than one line for the same encounter, at the same charge. That pattern matches a duplicate line item and should be removed or fully explained before payment.",
        severity: "HIGH",
        estimatedImpact: erCharge,
        tokenizedEvidence: erLines[0].trim().slice(0, 180),
        confidence: "high",
        flaggedAsPotential: false,
      },
      1
    );
    if (item) findings.push(item);
  }

  const venipunctureCharge = amountForLine(text, (line) => /\b36415\b/.test(line));
  if (venipunctureCharge && erLines.length > 0) {
    const item = finding(
      "CMS-NCCI-UNBUNDLING",
      {
        title: "Potential unbundling: venipuncture billed beside an ER visit",
        explanation:
          "CPT 36415 (routine venipuncture) is often considered integral to an emergency evaluation. NCCI edits and payer rules determine whether it may be billed separately. This is a review flag, not a proven violation; ask the biller to confirm the modifier and payer policy.",
        severity: "MEDIUM",
        estimatedImpact: venipunctureCharge,
        tokenizedEvidence: codeLines(text, "36415")[0]?.trim().slice(0, 180),
        confidence: "medium",
        flaggedAsPotential: true,
      },
      2
    );
    if (item) findings.push(item);
  }

  const ibuprofenCharge = amountForLine(text, (line) => /ibuprofen/i.test(line));
  if (ibuprofenCharge && ibuprofenCharge >= 25) {
    const item = finding(
      "CMS-HOSPITAL-PRICE-TRANSPARENCY",
      {
        title: "Potential chargemaster markup on a common supply",
        explanation:
          "A high gross charge for a common medication is worth benchmarking against the hospital's published price file and the Medicare fee schedule. List-price markups are not automatically unlawful, but they are a legitimate basis for a written explanation or financial-assistance request.",
        severity: "MEDIUM",
        estimatedImpact: ibuprofenCharge,
        tokenizedEvidence: codeLines(text, "ibuprofen")[0]?.trim().slice(0, 180),
        confidence: "medium",
        flaggedAsPotential: true,
      },
      3
    );
    if (item) findings.push(item);
  }

  return findings;
}

function buildLeaseFindings(wire: WirePayload): AuditFinding[] {
  const text = wire.sanitizedText;
  const lower = text.toLowerCase();
  const findings: AuditFinding[] = [];
  const isNewYork = wire.jurisdiction.toLowerCase().includes("new york");

  const deposit = amountForLine(text, (line) => /security deposit/i.test(line));
  const rent = amountForLine(text, (line) => /(monthly rent|rent of|rent is)/i.test(line));
  const excess = deposit && rent ? Math.max(0, deposit - rent) : 0;

  if (isNewYork) {
    if (deposit && rent && excess > 0) {
      const item = finding(
        "NYC-GOB-7-108-DEPOSIT-CAP",
        {
          title: "Security deposit exceeds the one-month limit",
          explanation: `The document states a security deposit of about $${deposit.toLocaleString("en-US")} against monthly rent of about $${rent.toLocaleString("en-US")}. New York law generally limits a residential deposit to one month's rent.`,
          severity: "HIGH",
          estimatedImpact: excess > 0 ? excess : null,
          confidence: "high",
          flaggedAsPotential: false,
        },
        1
      );
      if (item) findings.push(item);
    }
    if (/habitability|waive|waiver|as-is|as is|repair/i.test(lower)) {
      const item = finding(
        "NYC-RPL-235-B-HABITABILITY",
        {
          title: "Possible waiver of the warranty of habitability",
          explanation:
            "The lease appears to waive or shift repair and habitability obligations. New York's warranty of habitability cannot be waived by agreement, so this clause is a strong candidate for removal.",
          severity: "HIGH",
          confidence: "medium",
          flaggedAsPotential: false,
        },
        2
      );
      if (item) findings.push(item);
    }
    if (/late fee|application fee|grace period/i.test(lower)) {
      const item = finding(
        "NYC-RPL-238-A-APPLICATION-FEES",
        {
          title: "Check fees against New York limits",
          explanation:
            "New York limits application fees and late fees. Compare the stated fee and grace period with the statutory caps before signing.",
          severity: "MEDIUM",
          confidence: "medium",
          flaggedAsPotential: true,
        },
        3
      );
      if (item) findings.push(item);
    }
    return findings;
  }

  if (deposit && rent && excess > 0) {
    const item = finding(
      "CA-CIV-1950.5-DEPOSIT-CAP",
      {
        title: "Security deposit exceeds California's one-month cap",
        explanation: `The document states a security deposit of about $${deposit.toLocaleString("en-US")} against monthly rent of about $${rent.toLocaleString("en-US")}. For most California rentals, AB 12 limits the deposit to one month's rent. A narrow small-landlord exception may allow up to two months; furnished units are not exempt.`,
        severity: "HIGH",
        estimatedImpact: excess > 0 ? excess : null,
        confidence: "high",
        flaggedAsPotential: false,
      },
      1
    );
    if (item) findings.push(item);
  }

  if (/habitability|waive|waiver|as-is|as is|repair/i.test(lower)) {
    const item = finding(
      "CA-CIV-1941.1-HABITABILITY",
      {
        title: "Possible waiver of the implied warranty of habitability",
        explanation:
          "The lease appears to disclaim or waive the landlord's repair and habitability obligations. California treats a blanket waiver of the implied warranty of habitability as void, so this clause should be removed or narrowed.",
        severity: "HIGH",
        confidence: "medium",
        flaggedAsPotential: false,
      },
      2
    );
    if (item) findings.push(item);
  }

  if (/deposit return|itemized|21 days|deduction/i.test(lower)) {
    const item = finding(
      "CA-CIV-1950.5-DEPOSIT-RETURN",
      {
        title: "Confirm the deposit return and itemization deadline",
        explanation:
          "California generally requires the deposit or an itemized deduction statement within 21 days. The lease's return process should not shorten tenant rights or delay itemization.",
        severity: "MEDIUM",
        confidence: "medium",
        flaggedAsPotential: true,
      },
      3
    );
    if (item) findings.push(item);
  }

  return findings;
}

function buildEmploymentFindings(wire: WirePayload): AuditFinding[] {
  const text = wire.sanitizedText;
  const lower = text.toLowerCase();
  const findings: AuditFinding[] = [];

  if (/non-?compete|shall not compete|competing business/i.test(lower)) {
    const item = finding(
      "CA-BPC-16600-NONCOMPETE",
      {
        title: "California non-compete clause is likely void",
        explanation:
          "The agreement restricts competitive employment after separation. California voids most employee non-competes, and since 2024 § 16600.5 extends that rule to contracts signed elsewhere and creates exposure for attempts to enforce them.",
        severity: "HIGH",
        confidence: "high",
        flaggedAsPotential: false,
      },
      1
    );
    if (item) findings.push(item);
  }

  if (/wage|compensation|salary/i.test(lower) && /discuss|disclos|confidential/i.test(lower)) {
    const item = finding(
      "CA-LAB-232-WAGE-DISCUSSION",
      {
        title: "Restriction on discussing compensation",
        explanation:
          "The agreement appears to bar discussing pay or compensation with others. California Labor Code § 232 voids such restrictions, and a broad confidentiality clause that captures wages can violate it.",
        severity: "HIGH",
        confidence: "high",
        flaggedAsPotential: false,
      },
      2
    );
    if (item) findings.push(item);
  }

  if (/severance|final pay|last paycheck/i.test(lower)) {
    const item = finding(
      "CA-LAB-206-FINAL-PAY",
      {
        title: "Severance and final-pay terms need review",
        explanation:
          "Already-earned wages are generally due on the statutory schedule, while additional severance may be conditioned on a lawful release. Confirm the agreement does not condition earned wages on signing.",
        severity: "MEDIUM",
        confidence: "medium",
        flaggedAsPotential: true,
      },
      3
    );
    if (item) findings.push(item);
  }

  return findings;
}

function riskScore(findings: AuditFinding[]): number {
  const score = findings.reduce((sum, item) => {
    if (item.severity === "HIGH") return sum + 34;
    if (item.severity === "MEDIUM") return sum + 16;
    return sum + 6;
  }, 0);
  return Math.min(100, score);
}

export function buildTokenizedDraft(wire: WirePayload, findings: AuditFinding[]): string {
  const recipient =
    findRoleToken(wire.roleHints, ["landlord", "clinic", "insurer", "employer"]) ??
    (wire.documentType === "medical_bill"
      ? "Billing Department"
      : wire.documentType === "residential_lease"
        ? "Landlord"
        : "Employer");
  const sender =
    findRoleToken(wire.roleHints, ["patient", "tenant", "employee", "claimant"]) ??
    "the undersigned";
  const titles = findings.map((item) => item.title).join("; ");
  const total = findings.reduce((sum, item) => sum + (item.estimatedImpact ?? 0), 0);

  return [
    `To: ${recipient}`,
    `Re: ${wire.documentType.replace(/_/g, " ")} — ${wire.jurisdiction}`,
    "",
    `${sender} disputes the following issues: ${titles || "the charges and clauses identified in the attached review"}.`,
    total > 0
      ? `Estimated financial impact: $${total.toLocaleString("en-US")}.`
      : "Please provide a written explanation and corrected documents.",
    "",
    "Please respond within 30 days. This draft was generated from the bundled 2026 Rule Packs and is not legal or medical advice.",
  ].join("\n");
}

const SUMMARY: Record<DocumentType, string> = {
  medical_bill:
    "Deterministic review found billing patterns worth disputing, including a duplicate line item and potential coding/markup issues. Confirm each item against the payer policy and the hospital's published prices.",
  residential_lease:
    "Deterministic review found lease terms that conflict with the selected jurisdiction's 2026 tenant protections. Request a corrected agreement before signing or paying.",
  employment_contract:
    "Deterministic review found employment restrictions that are likely unenforceable under California law. Request the clauses be removed before signing.",
};

export function buildCachedDemoAudit(
  wire: WirePayload,
  options: CachedDemoOptions = {}
): AuditReport {
  let findings: AuditFinding[] =
    wire.documentType === "medical_bill"
      ? buildMedicalFindings(wire)
      : wire.documentType === "residential_lease"
        ? buildLeaseFindings(wire)
        : buildEmploymentFindings(wire);

  const jurisdiction = wire.jurisdiction.toLowerCase();
  if (
    wire.documentType === "employment_contract" &&
    !jurisdiction.includes("california")
  ) {
    findings = [];
  }
  if (
    wire.documentType === "residential_lease" &&
    !jurisdiction.includes("california") &&
    !jurisdiction.includes("new york")
  ) {
    findings = [];
  }

  findings = findings.filter(Boolean);
  const estimated = findings.reduce((sum, item) => sum + (item.estimatedImpact ?? 0), 0);
  const rulePacks = getRulePackIdsFor(wire.jurisdiction, wire.documentType);

  const warnings = [
    "Cached demo result — cloud audit unavailable. This is a deterministic preview built from the bundled 2026 Rule Packs, not a live Gemini audit.",
  ];
  if (options.reason) warnings.push(options.reason);

  return {
    auditId: options.auditId ?? createId("audit"),
    documentType: wire.documentType,
    jurisdiction: wire.jurisdiction,
    createdAt: Date.now(),
    overallRiskScore: riskScore(findings),
    estimatedSavings: estimated > 0 ? estimated : null,
    summary:
      findings.length === 0
        ? "The cached preview did not find a specific violation supported by the bundled 2026 Rule Packs for this document. That is not proof the document is fair; review it manually or retry when the cloud auditor is available."
        : SUMMARY[wire.documentType],
    findings,
    tokenizedDisputeDraft: buildTokenizedDraft(wire, findings),
    rulePackVersion: getRulePackVersionFor(wire.jurisdiction, wire.documentType),
    rulePackIds: rulePacks,
    source: "cached_demo",
    cloudModel: "cached-demo",
    cloudInferenceSource: "none",
    droppedCitations: [],
    latencyMs: 0,
    warnings,
  };
}
