/**
 * Bundled 2026 Jurisdiction & Billing Rule Packs.
 *
 * Every citation points at an official `https:` government source. These are
 * summaries for consumer education, not legal advice. Versions are pinned so
 * an audit can record exactly which rules it ran against.
 */

import type { DocumentType, Severity } from "../types";

export type RulePackId = "ca-2026" | "nyc-2026" | "cms-2026";

export interface Rule {
  ruleId: string;
  packId: RulePackId;
  title: string;
  summary: string;
  citation: string;
  url: string;
  severityHint: Severity;
  appliesTo: DocumentType[];
  keywords: string[];
  /** Potentially compliant facts still need payer/policy review. */
  potential: boolean;
}

export interface RulePack {
  id: RulePackId;
  label: string;
  jurisdictionLabel: string;
  version: string;
  updated: string;
  description: string;
  rules: Rule[];
}

export const RULE_PACK_VERSION = "2026.1";
export const RULE_PACK_UPDATED = "2026-11-24";

export const RULE_PACK_DISCLAIMER =
  "Airlock is not a law firm and does not provide legal or medical advice. Rule Packs summarize public statutes and CMS guidance for educational review. Rules change and exceptions apply; verify each citation at its official source before you act.";

const CA_VERSION = RULE_PACK_VERSION;
const NYC_VERSION = RULE_PACK_VERSION;
const CMS_VERSION = RULE_PACK_VERSION;

const caRules: Rule[] = [
  {
    ruleId: "CA-CIV-1950.5-DEPOSIT-CAP",
    packId: "ca-2026",
    title: "California security deposit cap (AB 12)",
    summary:
      "For most residential rentals, a landlord may not demand or receive a security deposit exceeding one month's rent. AB 12 (2023) amended Civil Code § 1950.5, effective July 1, 2024. A narrow exception lets a natural-person owner of no more than two residential rental properties with four or fewer total units charge up to two months' rent; it does not apply to service members. Furnished units are not exempt from the one-month cap.",
    citation: "Cal. Civ. Code § 1950.5 (as amended by AB 12, 2023)",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5",
    severityHint: "HIGH",
    appliesTo: ["residential_lease"],
    keywords: ["security deposit", "deposit", "months' rent", "month's rent"],
    potential: false,
  },
  {
    ruleId: "CA-CIV-1950.5-DEPOSIT-RETURN",
    packId: "ca-2026",
    title: "Deposit return and itemization deadline",
    summary:
      "After a tenant vacates, a landlord must generally return the deposit or provide a written itemized statement of deductions within 21 calendar days (30 days if the lease expressly so provides). Improper withholding can expose the landlord to statutory damages.",
    citation: "Cal. Civ. Code § 1950.5(g)",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5",
    severityHint: "MEDIUM",
    appliesTo: ["residential_lease"],
    keywords: ["deposit return", "itemized", "21 days", "deduction", "withhold"],
    potential: true,
  },
  {
    ruleId: "CA-CIV-1941.1-HABITABILITY",
    packId: "ca-2026",
    title: "Implied warranty of habitability cannot be waived",
    summary:
      "Residential leases carry an implied warranty that the unit is fit for human habitation, covering items such as waterproofing, plumbing, heating, and electrical systems. A blanket waiver or 'as-is' clause purporting to waive this warranty is generally void as contrary to public policy.",
    citation: "Cal. Civ. Code §§ 1941.1, 1942.1",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1941.1",
    severityHint: "HIGH",
    appliesTo: ["residential_lease"],
    keywords: ["habitability", "waive", "waiver", "as-is", "as is", "repair", "warranty"],
    potential: false,
  },
  {
    ruleId: "CA-BPC-16600-NONCOMPETE",
    packId: "ca-2026",
    title: "California employee non-compete restriction",
    summary:
      "Contracts restraining a person from engaging in a lawful profession, trade, or business are void under Business and Professions Code § 16600. Since 2024, § 16600.5 adds that void non-competes are unenforceable regardless of where and when the contract was signed, and attempting to enforce one can expose the employer to liability.",
    citation: "Cal. Bus. & Prof. Code §§ 16600, 16600.5 (SB 699, 2023)",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=16600",
    severityHint: "HIGH",
    appliesTo: ["employment_contract"],
    keywords: ["non-compete", "noncompete", "compete", "solicit", "24 month", "24-month"],
    potential: false,
  },
  {
    ruleId: "CA-BPC-16600.5-VOID",
    packId: "ca-2026",
    title: "Void non-compete cannot be enforced or threatened",
    summary:
      "California Business and Professions Code § 16600.5 makes it unlawful to attempt to enforce a void non-compete, and gives affected employees a private right of action including injunctive relief and attorney's fees. A choice-of-law or forum clause does not rescue an otherwise void restraint for California workers.",
    citation: "Cal. Bus. & Prof. Code § 16600.5",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=16600.5",
    severityHint: "HIGH",
    appliesTo: ["employment_contract"],
    keywords: ["non-compete", "noncompete", "governed by", "venue", "choice of law"],
    potential: false,
  },
  {
    ruleId: "CA-LAB-232-WAGE-DISCUSSION",
    packId: "ca-2026",
    title: "Restrictions on discussing wages are unlawful",
    summary:
      "California Labor Code § 232 voids any agreement that prohibits an employee from disclosing the amount of their wages or discussing wages with others. A confidentiality clause that sweeps in compensation can violate this section.",
    citation: "Cal. Labor Code § 232",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=232",
    severityHint: "HIGH",
    appliesTo: ["employment_contract"],
    keywords: ["wage", "wages", "compensation", "salary", "discuss", "disclose", "confidential"],
    potential: false,
  },
  {
    ruleId: "CA-LAB-206-FINAL-PAY",
    packId: "ca-2026",
    title: "Final wages due at separation",
    summary:
      "Under Labor Code § 201 and § 202, final wages are generally due at the time of discharge, or within 72 hours of resignation without notice. A severance agreement cannot lawfully condition already-earned wages on a release, though it may condition additional severance pay on a valid release.",
    citation: "Cal. Labor Code §§ 201, 202, 206",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=206",
    severityHint: "MEDIUM",
    appliesTo: ["employment_contract"],
    keywords: ["final pay", "final wages", "last paycheck", "severance", "release", "resignation"],
    potential: true,
  },
];

const nycRules: Rule[] = [
  {
    ruleId: "NYC-GOB-7-108-DEPOSIT-CAP",
    packId: "nyc-2026",
    title: "New York security deposit limited to one month",
    summary:
      "Since the 2019 Housing Stability and Tenant Protection Act, a landlord may not demand a security deposit exceeding one month's rent for a residential lease. The deposit must be held in trust and returned with an itemized statement within 14 days of vacancy.",
    citation: "N.Y. Gen. Oblig. Law § 7-108",
    url: "https://www.nysenate.gov/legislation/laws/GOB/7-108",
    severityHint: "HIGH",
    appliesTo: ["residential_lease"],
    keywords: ["security deposit", "deposit", "months' rent", "month's rent"],
    potential: false,
  },
  {
    ruleId: "NYC-RPL-235-B-HABITABILITY",
    packId: "nyc-2026",
    title: "New York warranty of habitability",
    summary:
      "Residential leases imply a covenant that the premises are fit for human habitation. The covenant cannot be waived, and a lease clause purporting to shift repair obligations or disclaim habitability is generally unenforceable.",
    citation: "N.Y. Real Prop. Law § 235-b",
    url: "https://www.nysenate.gov/legislation/laws/RPP/235-B",
    severityHint: "HIGH",
    appliesTo: ["residential_lease"],
    keywords: ["habitability", "waive", "waiver", "as-is", "as is", "repair", "heat", "hot water"],
    potential: false,
  },
  {
    ruleId: "NYC-RPL-235-A-LEASE-TERMS",
    packId: "nyc-2026",
    title: "Non-waivable lease protections",
    summary:
      "Real Property Law § 235-a prevents landlords from contracting around statutory tenant protections, including provisions on notice, eviction procedure, and habitability. Clauses that purport to waive those rights are subject to challenge.",
    citation: "N.Y. Real Prop. Law § 235-a",
    url: "https://www.nysenate.gov/legislation/laws/RPP/235-A",
    severityHint: "MEDIUM",
    appliesTo: ["residential_lease"],
    keywords: ["waive", "waiver", "notice", "eviction", "rights", "jurisdiction"],
    potential: true,
  },
  {
    ruleId: "NYC-RPL-238-A-APPLICATION-FEES",
    packId: "nyc-2026",
    title: "Limits on rental application fees",
    summary:
      "Real Property Law § 238-a limits residential rental application fees to the lesser of actual cost or $20, and restricts late fees to the lesser of $50 or 5% of monthly rent (with a grace period).",
    citation: "N.Y. Real Prop. Law § 238-a",
    url: "https://www.nysenate.gov/legislation/laws/RPP/238-A",
    severityHint: "MEDIUM",
    appliesTo: ["residential_lease"],
    keywords: ["application fee", "late fee", "late charge", "grace period"],
    potential: false,
  },
];

const cmsRules: Rule[] = [
  {
    ruleId: "CMS-NCCI-UNBUNDLING",
    packId: "cms-2026",
    title: "NCCI procedure-to-procedure edits and unbundling",
    summary:
      "The National Correct Coding Initiative (NCCI) procedure-to-procedure edits identify code pairs that generally should not be billed together. Billing a component service separately with a comprehensive service can be unbundling. Applicability depends on the specific code pair, modifier support, and payer policy, so treat this as a review flag rather than a conclusion.",
    citation: "CMS NCCI Procedure-to-Procedure (PTP) Edits",
    url: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits",
    severityHint: "MEDIUM",
    appliesTo: ["medical_bill"],
    keywords: ["unbundl", "36415", "99284", "venipuncture", "bundled", "component"],
    potential: true,
  },
  {
    ruleId: "CMS-NCCI-POLICY-MANUAL",
    packId: "cms-2026",
    title: "NCCI Policy Manual coding standards",
    summary:
      "The Medicare NCCI Policy Manual explains when services are considered integral to a primary procedure and should not be reported separately. Chapter 1 covers general correct coding policy. Payers may apply stricter or different edits, so confirmation with the payer is required.",
    citation: "Medicare NCCI Policy Manual, Chapter 1",
    url: "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-policy-manual",
    severityHint: "MEDIUM",
    appliesTo: ["medical_bill"],
    keywords: ["integral", "correct coding", "separately report", "modifier 25", "bundle"],
    potential: true,
  },
  {
    ruleId: "CMS-DUPLICATE-CLAIM",
    packId: "cms-2026",
    title: "Duplicate claims and duplicate line items",
    summary:
      "Medicare claims processing instructions direct contractors to deny duplicate claims for the same service, same beneficiary, and same date of service. A repeated line item for an identical CPT code, date, and charge is a strong candidate for correction before payment.",
    citation: "CMS Medicare Claims Processing Manual, Chapter 1",
    url: "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c01.pdf",
    severityHint: "HIGH",
    appliesTo: ["medical_bill"],
    keywords: ["duplicate", "same service", "99284", "charged twice", "repeated"],
    potential: false,
  },
  {
    ruleId: "CMS-HOSPITAL-PRICE-TRANSPARENCY",
    packId: "cms-2026",
    title: "Hospital price transparency and chargemaster rates",
    summary:
      "Hospitals must publish machine-readable standard charges and, for consumers, a shoppable display of at least 300 services. A gross chargemaster rate that is far above published negotiated or cash prices is a legitimate question to raise, but list-price markups are not automatically unlawful.",
    citation: "CMS Hospital Price Transparency (45 C.F.R. Part 180)",
    url: "https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency",
    severityHint: "MEDIUM",
    appliesTo: ["medical_bill"],
    keywords: ["chargemaster", "markup", "list price", "standard charge", "ibuprofen", "supply"],
    potential: true,
  },
  {
    ruleId: "CMS-NO-SURPRISES-ACT",
    packId: "cms-2026",
    title: "No Surprises Act protections for emergency care",
    summary:
      "The No Surprises Act generally bars balance billing for emergency services and certain out-of-network services at in-network facilities, and requires a good-faith cost estimate for uninsured or self-pay patients. Protections depend on coverage, network status, and plan type.",
    citation: "No Surprises Act (Pub. L. 116-260), CMS guidance",
    url: "https://www.cms.gov/nosurprises",
    severityHint: "HIGH",
    appliesTo: ["medical_bill"],
    keywords: ["out-of-network", "balance bill", "balance billing", "surprise bill", "emergency", "self-pay"],
    potential: true,
  },
  {
    ruleId: "CMS-PFS-FEE-SCHEDULE",
    packId: "cms-2026",
    title: "Verify charges against the Medicare Physician Fee Schedule",
    summary:
      "The Medicare Physician Fee Schedule publishes national payment rates by CPT/HCPCS code and locality. It is not a price cap for commercial plans, but it is a useful benchmark for judging whether a line-item charge is unusually high.",
    citation: "CMS Medicare Physician Fee Schedule",
    url: "https://www.cms.gov/medicare/payment/fee-schedules/physician",
    severityHint: "LOW",
    appliesTo: ["medical_bill"],
    keywords: ["fee schedule", "benchmark", "allowed amount", "reasonable charge"],
    potential: true,
  },
  {
    ruleId: "CMS-MEDICAL-BILL-RIGHTS",
    packId: "cms-2026",
    title: "Itemized bill and appeal rights",
    summary:
      "Patients can request an itemized bill and, for insurance denials, an internal appeal and often an external review. CMS publishes consumer guidance on medical bill rights and dispute pathways.",
    citation: "CMS Medical Bill Rights",
    url: "https://www.cms.gov/medical-bill-rights",
    severityHint: "LOW",
    appliesTo: ["medical_bill"],
    keywords: ["itemized", "appeal", "denial", "explanation of benefits", "eob"],
    potential: false,
  },
];

export const RULE_PACKS: RulePack[] = [
  {
    id: "ca-2026",
    label: "California 2026",
    jurisdictionLabel: "California, US",
    version: CA_VERSION,
    updated: RULE_PACK_UPDATED,
    description: "Tenant deposits and habitability, employment restraints, wage rights.",
    rules: caRules,
  },
  {
    id: "nyc-2026",
    label: "New York City 2026",
    jurisdictionLabel: "New York City, US",
    version: NYC_VERSION,
    updated: RULE_PACK_UPDATED,
    description: "NYC rental deposits, habitability, non-waivable lease protections.",
    rules: nycRules,
  },
  {
    id: "cms-2026",
    label: "CMS Billing 2026",
    jurisdictionLabel: "Federal billing rules",
    version: CMS_VERSION,
    updated: RULE_PACK_UPDATED,
    description: "NCCI edits, duplicate claims, price transparency, surprise billing.",
    rules: cmsRules,
  },
];

const ALL_RULES: Rule[] = RULE_PACKS.flatMap((pack) => pack.rules);

export function getRulePackById(id: RulePackId): RulePack | undefined {
  return RULE_PACKS.find((pack) => pack.id === id);
}

function jurisdictionPackId(jurisdiction: string): RulePackId | null {
  const normalized = jurisdiction.trim().toLowerCase();
  if (normalized.includes("california")) return "ca-2026";
  if (normalized.includes("new york")) return "nyc-2026";
  return null;
}

/**
 * Resolve the packs that apply to a document. Medical bills always include the
 * CMS billing pack, plus the jurisdiction pack when one exists.
 */
export function getRulePack(jurisdiction: string, documentType: DocumentType): RulePack[] {
  const packs: RulePack[] = [];
  if (documentType === "medical_bill") {
    const cms = getRulePackById("cms-2026");
    if (cms) packs.push(cms);
  }
  const jurisdictionId = jurisdictionPackId(jurisdiction);
  const local = jurisdictionId ? getRulePackById(jurisdictionId) : undefined;
  if (local) packs.push(local);

  return packs
    .map((pack) => ({
      ...pack,
      rules: pack.rules.filter((rule) => rule.appliesTo.includes(documentType)),
    }))
    .filter((pack) => pack.rules.length > 0);
}

export function getRuleById(ruleId: string): Rule | undefined {
  return ALL_RULES.find((rule) => rule.ruleId === ruleId);
}

export function getRuleByIdWithPack(
  ruleId: string
): { rule: Rule; pack: RulePack } | undefined {
  for (const pack of RULE_PACKS) {
    const rule = pack.rules.find((candidate) => candidate.ruleId === ruleId);
    if (rule) return { rule, pack };
  }
  return undefined;
}

export function getAllRuleIds(): string[] {
  return ALL_RULES.map((rule) => rule.ruleId);
}

export const OFFICIAL_RULE_HOSTS = [
  "cms.gov",
  "leginfo.legislature.ca.gov",
  "nysenate.gov",
  "nyc.gov",
  "ag.ny.gov",
  "hhs.gov",
];

export function isAllowedCitationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return OFFICIAL_RULE_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

export interface VerifiedCitation {
  ruleId: string;
  title: string;
  citation: string;
  url: string;
  packId: RulePackId;
  packLabel: string;
  version: string;
}

/** Allowlist gate used by the cloud auditor before any citation is rendered. */
export function resolveVerifiedCitation(ruleId: string): VerifiedCitation | null {
  const found = getRuleByIdWithPack(ruleId);
  if (!found) return null;
  if (!isAllowedCitationUrl(found.rule.url)) return null;
  return {
    ruleId: found.rule.ruleId,
    title: found.rule.title,
    citation: found.rule.citation,
    url: found.rule.url,
    packId: found.pack.id,
    packLabel: found.pack.label,
    version: found.pack.version,
  };
}

export function getRulePackVersionFor(
  jurisdiction: string,
  documentType: DocumentType
): string {
  const packs = getRulePack(jurisdiction, documentType);
  if (packs.length === 0) return RULE_PACK_VERSION;
  return packs.map((pack) => `${pack.id}@${pack.version}`).join(", ");
}

export function getRulePackIdsFor(
  jurisdiction: string,
  documentType: DocumentType
): string[] {
  return getRulePack(jurisdiction, documentType).map((pack) => pack.id);
}
