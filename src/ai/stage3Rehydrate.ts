/**
 * Stage 3: local-only rehydration, deterministic letter building, optional
 * on-device tone polish, and export helpers.
 */

import type { AuditReport, DocumentType, LetterState, Tone } from "../types";
import type { WirePayload } from "../vault/wireBoundary";
import {
  rehydrateText,
  TOKEN_SCAN,
  type RehydrateResult,
} from "../vault/rehydrate";
import { isLocalNanoReady, runLocalOnly } from "./modelFactory";
import { buildTonePolishPrompt } from "./prompts";

export { rehydrateText };
export type { RehydrateResult };

const DOCUMENT_PHRASE: Record<DocumentType, string> = {
  medical_bill: "itemized medical bill",
  residential_lease: "residential lease",
  employment_contract: "employment / severance agreement",
};

function firstTokenByPrefix(
  tokenMap: Record<string, string>,
  prefix: string
): string | null {
  const match = Object.keys(tokenMap).find((token) => token.startsWith(`[${prefix}_`));
  return match ?? null;
}

function tokenForRoles(
  roleHints: Record<string, string>,
  roles: string[]
): string | null {
  for (const role of roles) {
    for (const [token, hint] of Object.entries(roleHints)) {
      if (hint.toLowerCase() === role) return token;
    }
  }
  return null;
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export interface LetterBuildInput {
  documentType: DocumentType;
  jurisdiction: string;
  report: AuditReport;
  roleHints: Record<string, string>;
  tokenMap: Record<string, string>;
  wire: WirePayload;
  now?: Date;
}

const TONE_OPENING: Record<Tone, (phrase: string) => string> = {
  formal: (phrase) =>
    `I am writing to formally dispute the enclosed ${phrase}. I have reviewed it line by line, and the issues below require correction.`,
  collaborative: (phrase) =>
    `I would appreciate the opportunity to resolve this matter about my ${phrase} directly and without escalation. I have reviewed the document and identified the following concerns.`,
  escalation: (phrase) =>
    `This letter is formal notice that I dispute the ${phrase} described below and intend to pursue all remedies available to me if it is not corrected.`,
};

function recipientFor(
  input: LetterBuildInput,
  fallback: string
): string {
  const role = tokenForRoles(input.roleHints, [
    "landlord",
    "clinic",
    "insurer",
    "employer",
    "billing",
  ]);
  if (role) return role;
  const org = firstTokenByPrefix(input.tokenMap, "ORG");
  if (org) return org;
  return fallback;
}

function addressNearToken(text: string, token: string, window = 260): string | null {
  if (!token.startsWith("[ORG_") && !token.startsWith("[PERSON_")) return null;
  const index = text.indexOf(token);
  if (index === -1) return null;
  const slice = text.slice(index + token.length, index + token.length + window);
  const match = slice.match(/\[ADDRESS_\d+\]/);
  return match?.[0] ?? null;
}

function senderFor(input: LetterBuildInput): string {
  return (
    tokenForRoles(input.roleHints, ["patient", "tenant", "employee", "executive", "claimant"]) ||
    firstTokenByPrefix(input.tokenMap, "PERSON") ||
    (input.documentType === "medical_bill"
      ? "the patient"
      : input.documentType === "residential_lease"
        ? "the tenant"
        : "the employee")
  );
}

function requestFor(input: LetterBuildInput, totalImpact: number): string {
  if (input.documentType === "medical_bill") {
    if (totalImpact > 0) {
      return `I request a corrected itemized statement and a refund or credit of approximately ${formatMoney(totalImpact)}. If any charge is correct, please provide the specific code, date, and supporting documentation.`;
    }
    return "I request a corrected, fully itemized statement and written confirmation that any duplicate or bundled charges have been removed.";
  }
  if (input.documentType === "residential_lease") {
    return "I request that the unlawful deposit amount be reduced to the lawful maximum, that any waiver of habitability be removed, and that I receive a corrected copy of the agreement for signature.";
  }
  return "I request that the unenforceable non-compete and the restriction on discussing compensation be removed, and that I receive a corrected agreement for review.";
}

export function buildTokenizedDisputeLetter(input: LetterBuildInput, tone: Tone): string {
  const sender = senderFor(input);
  const recipient = recipientFor(
    input,
    input.documentType === "medical_bill"
      ? "Billing Department"
      : input.documentType === "residential_lease"
        ? "Landlord"
        : "Employer"
  );
  const address = addressNearToken(input.wire.sanitizedText, recipient);
  const totalImpact = input.report.findings.reduce(
    (sum, finding) => sum + (finding.estimatedImpact ?? 0),
    0
  );
  const findings = input.report.findings;

  const lines: string[] = [];
  lines.push(formatLongDate(input.now ?? new Date()));
  lines.push("");
  lines.push(recipient);
  if (address) lines.push(address);
  lines.push("");
  lines.push(`Re: ${DOCUMENT_PHRASE[input.documentType]} — ${input.jurisdiction}`);
  if (input.report.rulePackVersion) {
    lines.push(`Rule pack: ${input.report.rulePackVersion}`);
  }
  lines.push("");
  lines.push("Dear Sir or Madam:");
  lines.push("");
  lines.push(TONE_OPENING[tone](DOCUMENT_PHRASE[input.documentType]));
  lines.push("");

  if (findings.length === 0) {
    lines.push(
      "A rule-backed review did not identify a specific violation in the supplied rule pack, but I am requesting a written explanation of every charge and clause so I can verify them independently."
    );
    lines.push("");
  } else {
    lines.push("The specific issues are:");
    lines.push("");
    findings.forEach((finding, index) => {
      lines.push(`${index + 1}. ${finding.title} (${finding.severity})`);
      lines.push(`   ${finding.explanation}`);
      if (finding.estimatedImpact && finding.estimatedImpact > 0) {
        lines.push(`   Estimated financial impact: ${formatMoney(finding.estimatedImpact)}.`);
      }
      if (finding.citation) {
        lines.push(
          `   Reference: ${finding.citation}${finding.citationUrl ? ` — ${finding.citationUrl}` : ""}`
        );
      }
      if (finding.tokenizedEvidence) {
        lines.push(`   Document language: "${finding.tokenizedEvidence}"`);
      }
      lines.push("");
    });
  }

  lines.push(requestFor(input, totalImpact));
  lines.push("");
  lines.push(
    "Please respond within 30 days of the date of this letter. I am retaining a copy of the document and this correspondence."
  );
  lines.push("");
  lines.push("Sincerely,");
  lines.push(sender);
  lines.push("");
  lines.push("---");
  lines.push(
    "Prepared with Airlock document-review assistance. Airlock is not a law firm and this letter is not legal or medical advice."
  );

  return lines.join("\n");
}

function countTokenSet(text: string): string[] {
  return [...new Set(text.match(TOKEN_SCAN) ?? [])];
}

export interface PolishResult {
  text: string;
  polished: boolean;
  warning?: string;
}

/**
 * Optional local tone polish. The letter is tokenized, so no raw PII reaches
 * the model; every token must survive, otherwise the polished text is rejected.
 */
export async function polishTokenizedLetter(
  letter: string,
  tone: Tone
): Promise<PolishResult> {
  if (!(await isLocalNanoReady())) {
    return {
      text: letter,
      polished: false,
      warning: "Deterministic draft kept — Gemini Nano is unavailable for tone polish.",
    };
  }

  try {
    const result = await runLocalOnly(buildTonePolishPrompt(letter, tone));
    let polished = result.response.text().trim();
    polished = polished.replace(/^```(?:text|markdown)?\s*/i, "").replace(/```$/, "").trim();
    if (!polished) {
      return { text: letter, polished: false, warning: "Nano returned an empty polish; kept the deterministic draft." };
    }
    if (polished.length < letter.length * 0.55 || polished.length > letter.length * 1.8) {
      return {
        text: letter,
        polished: false,
        warning: "Nano's polish changed the letter length too much; kept the deterministic draft.",
      };
    }
    const originalTokens = countTokenSet(letter);
    for (const token of originalTokens) {
      if (!polished.includes(token)) {
        return {
          text: letter,
          polished: false,
          warning: `Nano dropped ${token}; the polish was rejected to protect rehydration.`,
        };
      }
    }
    const unknownTokens = countTokenSet(polished).filter(
      (token) => !originalTokens.includes(token)
    );
    if (unknownTokens.length > 0) {
      return {
        text: letter,
        polished: false,
        warning: "Nano invented a token; the polish was rejected to protect rehydration.",
      };
    }
    if (polished.includes("<untrusted_document>") || polished.includes("</untrusted_document>")) {
      return {
        text: letter,
        polished: false,
        warning: "Nano echoed a delimiter; kept the deterministic draft.",
      };
    }
    return { text: polished, polished: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown local error";
    if (message.startsWith("PRIVACY_VIOLATION")) {
      return {
        text: letter,
        polished: false,
        warning: "Local polish was rejected by the inference-source guard.",
      };
    }
    return {
      text: letter,
      polished: false,
      warning: "Local tone polish failed; kept the deterministic draft.",
    };
  }
}

export async function buildLetterState(
  input: LetterBuildInput,
  tone: Tone,
  options: { polish?: boolean } = {}
): Promise<LetterState> {
  const cloudDraft =
    input.report.source === "cloud" ? input.report.tokenizedDisputeDraft.trim() : "";
  const useCloudDraft =
    cloudDraft.length >= 120 && (options.polish === true || tone === "formal");
  const tokenized = useCloudDraft
    ? cloudDraft
    : buildTokenizedDisputeLetter(input, tone);
  let working = tokenized;
  let polished = false;
  let warning: string | undefined;

  if (options.polish) {
    const result = await polishTokenizedLetter(tokenized, tone);
    working = result.text;
    polished = result.polished;
    warning = result.warning;
  }

  const rehydrated = rehydrateText(working, input.tokenMap);
  const warnings: string[] = [];
  if (warning) warnings.push(warning);
  if (rehydrated.unknownTokens.length > 0) {
    warnings.push(
      `${rehydrated.unknownTokens.length} token(s) could not be matched to the local vault and were left untouched.`
    );
  }

  return {
    tokenized: working,
    final: rehydrated.text,
    tone,
    polished,
    warnings,
  };
}

export function letterFilename(documentType: DocumentType, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `airlock-${documentType.replace(/_/g, "-")}-${stamp}.txt`;
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printTextDocument(title: string, text: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("Printing is not available in this browser.");
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12pt;line-height:1.55;color:#111;margin:32px;}pre{white-space:pre-wrap;font-family:inherit;}</style>" +
      `</head><body><pre>${escapeHtml(text)}</pre></body></html>`
  );
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 2000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}
