/**
 * Firebase AI Logic model factory.
 *
 * Three inference modes, three jobs:
 *  - ONLY_ON_DEVICE  → Stage 1 scrubbing and Stage 3 tone polish (raw text)
 *  - ONLY_IN_CLOUD   → Stage 2 rule-backed structured JSON audit (wire only)
 *  - PREFER_ON_DEVICE→ offline triage (sanitized wire only)
 *
 * `runLocalOnly()` is the fail-closed guard for firebase-js-sdk#10635: it never
 * invokes ONLY_ON_DEVICE unless Chrome's LanguageModel API reports "available",
 * never calls countTokens() on raw text, and post-asserts the inference source.
 */

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerateContentResult,
  type GenerativeModel,
  type SchemaRequest,
  type TypedSchema,
} from "firebase/ai";
import { firebaseEnabled, getFirebaseRuntime } from "./firebaseConfig";
import { CLOUD_SYSTEM_INSTRUCTION } from "./prompts";

export type ResponseSchema = TypedSchema | SchemaRequest;

/**
 * Plain JSON Schema for Chrome's on-device Prompt API.
 *
 * Chrome does not accept Firebase's `Schema.object()` wrapper here; it expects
 * standard JSON Schema (`required` arrays, no `optionalProperties`). Keep this
 * separate from the cloud-side `triageResponseSchema`.
 */
export const TRIAGE_RESPONSE_CONSTRAINT = {
  type: "object",
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleId: { type: "string" },
          title: { type: "string" },
          explanation: { type: "string" },
          severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        required: ["ruleId", "title", "explanation"],
      },
    },
  },
  required: ["flags"],
};

let cachedAI: AI | null = null;

function requireAI(): AI {
  if (!firebaseEnabled) {
    throw new Error(
      "FIREBASE_DISABLED: Firebase environment variables are not configured. Use Local Demo Mode."
    );
  }
  const runtime = getFirebaseRuntime();
  if (!runtime) {
    throw new Error("FIREBASE_NOT_READY: Firebase has not finished initializing.");
  }
  if (!cachedAI) {
    cachedAI = getAI(runtime.app, { backend: new GoogleAIBackend() });
  }
  return cachedAI;
}

function getLanguageModelApi(): LanguageModelApi | undefined {
  if (typeof window === "undefined") return undefined;
  // The Firebase AI Logic web adapter reads exactly `window.LanguageModel`.
  // Never accept a different global here: doing so would make the pre-check
  // pass while the SDK still falls back to a cloud call (#10635).
  return window.LanguageModel;
}

/**
 * Hard pre-check for firebase-js-sdk#10635. If Chrome's on-device model is not
 * present and available, Airlock must never touch the SDK's local inference path.
 */
export async function isLocalNanoReady(): Promise<boolean> {
  if (!firebaseEnabled) return false;
  const languageModel = getLanguageModelApi();
  if (!languageModel || typeof languageModel.availability !== "function") return false;
  try {
    const status = await languageModel.availability();
    return status === "available";
  } catch {
    return false;
  }
}

export async function readNanoAvailability(): Promise<string> {
  const languageModel = getLanguageModelApi();
  if (!languageModel || typeof languageModel.availability !== "function") return "unavailable";
  try {
    return await languageModel.availability();
  } catch {
    return "unknown";
  }
}

/** Must be called from a user gesture. Streams download progress in [0, 1]. */
export async function initializeDeviceModel(
  onProgress?: (progress: number) => void
): Promise<boolean> {
  if (!firebaseEnabled) {
    throw new Error("FIREBASE_DISABLED: on-device inference requires a Firebase project.");
  }
  const languageModel = getLanguageModelApi();
  if (!languageModel) {
    throw new Error(
      "ON_DEVICE_UNAVAILABLE: Chrome's built-in LanguageModel API is not available in this browser."
    );
  }
  const model = getLocalAirlockModel();
  await model.initializeDeviceModel((progress) => {
    if (typeof progress === "number" && Number.isFinite(progress)) {
      onProgress?.(Math.max(0, Math.min(1, progress)));
    }
  });
  return isLocalNanoReady();
}

/** Stage 1 / Stage 3 local model. Constrained JSON is passed via promptOptions. */
export function getLocalAirlockModel(responseConstraint?: object): GenerativeModel {
  return getGenerativeModel(requireAI(), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: responseConstraint
      ? { promptOptions: { responseConstraint } }
      : undefined,
  });
}

/**
 * Safe wrapper for raw-text local inference. Never call the SDK's on-device
 * path directly; this is the only gate.
 */
export async function runLocalOnly(
  prompt: string,
  responseConstraint?: object
): Promise<GenerateContentResult> {
  if (!(await isLocalNanoReady())) {
    throw new Error(
      "ON_DEVICE_UNAVAILABLE: Refusing to invoke the SDK with raw document text because the on-device model is not available."
    );
  }
  const model = getLocalAirlockModel(responseConstraint);
  const result = await model.generateContent(prompt);
  const source = result.response.inferenceSource;
  if (source !== InferenceSource.ON_DEVICE) {
    const actual = source ?? "undefined";
    throw new Error(
      `PRIVACY_VIOLATION: Expected inferenceSource="${InferenceSource.ON_DEVICE}" but received "${actual}". Airlock rejected the result.`
    );
  }
  return result;
}

/** Stage 2 cloud auditor. Structured JSON only, no grounding, no tools. */
export function getCloudAuditorModel(
  responseSchema: ResponseSchema,
  cloudModelName = "gemini-4-hydrogen"
): GenerativeModel {
  return getGenerativeModel(requireAI(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: cloudModelName,
      systemInstruction: CLOUD_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: 8192,
      },
    },
  });
}

/**
 * Offline/hybrid triage. The caller must pass the already-sanitized WirePayload;
 * a silent cloud fallback therefore cannot leak raw text.
 */
export function getHybridTriageModel(
  cloudModelName = "gemini-3.5-flash-lite",
  responseSchema?: ResponseSchema
): GenerativeModel {
  return getGenerativeModel(requireAI(), {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: {
      model: cloudModelName,
      generationConfig: {
        responseMimeType: "application/json",
        ...(responseSchema ? { responseSchema } : {}),
        maxOutputTokens: 2048,
      },
    },
    // Chrome's Prompt API rejects Firebase's Schema.object() wrapper
    // (`optionalProperties` is not standard JSON Schema), so the on-device path
    // gets a plain JSON Schema while the cloud path keeps the typed schema.
    onDeviceParams: responseSchema
      ? { promptOptions: { responseConstraint: TRIAGE_RESPONSE_CONSTRAINT } }
      : undefined,
  });
}

export function extractResponseText(result: GenerateContentResult): string {
  try {
    return result.response.text();
  } catch {
    return "";
  }
}

export function readInferenceSource(result: GenerateContentResult): string {
  return result.response.inferenceSource ?? "unknown";
}

/** JSON schema hint for Chrome's on-device responseConstraint. */
export const SCRUB_RESPONSE_CONSTRAINT = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          category: {
            type: "string",
            enum: [
              "PERSON",
              "ORG",
              "ADDRESS",
              "ID_NUMBER",
              "CONTACT",
              "DATE",
              "ACCOUNT",
            ],
          },
          role: { type: "string" },
        },
        required: ["text", "category"],
      },
    },
  },
  required: ["entities"],
};
