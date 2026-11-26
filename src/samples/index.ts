/** Curated demo packs surfaced on the ingest screen. */

import type { DocumentType, JurisdictionValue } from "../types";
import { ADVERSARIAL_SAMPLE } from "./adversarialSample";
import { LEASE_SAMPLE } from "./leaseSample";
import { MEDICAL_BILL_SAMPLE } from "./medicalBillSample";
import { SEVERANCE_SAMPLE } from "./severanceSample";

export interface SampleDocument {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  documentType: DocumentType;
  jurisdiction: JurisdictionValue;
  label: string;
  text: string;
  adversarial: boolean;
  accent: "medical" | "lease" | "employment" | "adversarial";
}

export const SAMPLES: SampleDocument[] = [
  {
    id: "medical-duplicate",
    title: "ER bill with a duplicate charge",
    subtitle: "Metro General Hospital · $4,820",
    badge: "Duplicate CPT 99284",
    documentType: "medical_bill",
    jurisdiction: "California, US",
    label: "Metro General ER bill",
    text: MEDICAL_BILL_SAMPLE,
    adversarial: false,
    accent: "medical",
  },
  {
    id: "lease-deposit",
    title: "Lease with a 3-month deposit",
    subtitle: "Oakland, CA · AB 12 issue",
    badge: "Habitability waiver",
    documentType: "residential_lease",
    jurisdiction: "California, US",
    label: "Cypress Lane lease",
    text: LEASE_SAMPLE,
    adversarial: false,
    accent: "lease",
  },
  {
    id: "severance-noncompete",
    title: "Severance with a 24-month non-compete",
    subtitle: "Northwind Robotics · $265k",
    badge: "Wage gag clause",
    documentType: "employment_contract",
    jurisdiction: "California, US",
    label: "Northwind severance",
    text: SEVERANCE_SAMPLE,
    adversarial: false,
    accent: "employment",
  },
  {
    id: "adversarial-injection",
    title: "Adversarial prompt-injection lease",
    subtitle: "Red-team sample · not real data",
    badge: "Adversarial test",
    documentType: "residential_lease",
    jurisdiction: "California, US",
    label: "Prompt-injection lease",
    text: ADVERSARIAL_SAMPLE,
    adversarial: true,
    accent: "adversarial",
  },
];

export function getSampleById(id: string): SampleDocument | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}
