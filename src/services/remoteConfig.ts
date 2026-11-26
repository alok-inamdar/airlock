/**
 * Remote Config policy with safe, free-tier defaults.
 *
 * minimumFetchIntervalMillis is set to 0 in firebaseConfig so the "Refresh
 * Policy" button works during a live demo. Grounding is never enabled: it
 * requires a paid tier and this build is Spark-only.
 */

import { fetchAndActivate, getBoolean, getNumber, getString } from "firebase/remote-config";
import { firebaseEnabled, getFirebaseRuntime } from "../ai/firebaseConfig";
import { RULE_PACK_VERSION } from "../rules/rulePacks2026";
import { logRequest } from "./telemetry";

export type RedactionStrictness = "standard" | "strict";

export interface RemotePolicy {
  redactionStrictness: RedactionStrictness;
  cloudAuditorModel: string;
  maxChunkChars: number;
  rulePackVersion: string;
  enableSearchGrounding: boolean;
  source: "defaults" | "remote";
  fetchedAt: number | null;
  error: string | null;
  warnings: string[];
}

const ALLOWED_CLOUD_MODELS = new Set(["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);

export const REMOTE_CONFIG_DEFAULTS = {
  redaction_strictness: "strict",
  cloud_auditor_model: "gemini-4-hydrogen",
  max_chunk_chars: 1600,
  rule_pack_version: RULE_PACK_VERSION,
  enable_search_grounding: false,
} as const;

export function defaultPolicy(): RemotePolicy {
  return {
    redactionStrictness: REMOTE_CONFIG_DEFAULTS.redaction_strictness,
    cloudAuditorModel: REMOTE_CONFIG_DEFAULTS.cloud_auditor_model,
    maxChunkChars: REMOTE_CONFIG_DEFAULTS.max_chunk_chars,
    rulePackVersion: RULE_PACK_VERSION,
    enableSearchGrounding: false,
    source: "defaults",
    fetchedAt: null,
    error: null,
    warnings: [],
  };
}

function clampChunk(value: number): number {
  if (!Number.isFinite(value)) return 1600;
  return Math.min(4000, Math.max(500, Math.round(value)));
}

export async function loadRemotePolicy(): Promise<RemotePolicy> {
  const fallback = defaultPolicy();
  if (!firebaseEnabled) return fallback;
  const runtime = getFirebaseRuntime();
  if (!runtime) return fallback;

  try {
    await fetchAndActivate(runtime.remoteConfig);
    const warnings: string[] = [];

    const strictnessValue = getString(runtime.remoteConfig, "redaction_strictness").trim();
    const redactionStrictness: RedactionStrictness =
      strictnessValue === "standard" ? "standard" : "strict";

    const modelValue = getString(runtime.remoteConfig, "cloud_auditor_model").trim();
    let cloudAuditorModel = "gemini-4-hydrogen";
    if (ALLOWED_CLOUD_MODELS.has(modelValue)) {
      cloudAuditorModel = modelValue;
    } else if (modelValue) {
      warnings.push(
        `Remote model "${modelValue}" is not on the free-tier allowlist; using gemini-4-hydrogen.`
      );
    }

    const maxChunkChars = clampChunk(getNumber(runtime.remoteConfig, "max_chunk_chars"));

    const rulePackVersion =
      getString(runtime.remoteConfig, "rule_pack_version").trim() || RULE_PACK_VERSION;
    if (rulePackVersion !== RULE_PACK_VERSION) {
      warnings.push(
        `Remote rule pack version ${rulePackVersion} differs from the bundled ${RULE_PACK_VERSION}; bundled rules are used.`
      );
    }

    const requestedGrounding = getBoolean(runtime.remoteConfig, "enable_search_grounding");
    if (requestedGrounding) {
      warnings.push(
        "Remote Config requested Google Search Grounding. It is disabled because this build runs on the free tier."
      );
    }

    const policy: RemotePolicy = {
      redactionStrictness,
      cloudAuditorModel,
      maxChunkChars,
      rulePackVersion: RULE_PACK_VERSION,
      enableSearchGrounding: false,
      source: "remote",
      fetchedAt: Date.now(),
      error: null,
      warnings,
    };

    logRequest({
      kind: "remote_config",
      label: "Remote Config fetched and activated",
      detail: `strictness=${redactionStrictness} · model=${cloudAuditorModel} · chunks=${maxChunkChars}`,
      status: "ok",
    });

    return policy;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote Config fetch failed";
    logRequest({
      kind: "remote_config",
      label: "Remote Config unavailable — defaults kept",
      detail: message,
      status: "error",
    });
    return {
      ...fallback,
      error: message,
      warnings: ["Remote Config could not be fetched; local defaults are active."],
    };
  }
}
