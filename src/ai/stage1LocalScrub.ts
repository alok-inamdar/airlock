/**
 * Stage 1: chunked, on-device redaction with a deterministic fallback.
 *
 * Every model call is wrapped by `runLocalOnly()`, which pre-checks Chrome's
 * LanguageModel API and post-asserts `inferenceSource === "on_device"`.
 */

import type { DocumentType } from "../types";
import { chunkText } from "../vault/chunker";
import { runPiiFirewall, type FirewallHit } from "../vault/piiFirewall";
import { TokenRegistry } from "../vault/tokenMap";
import type { LocalScrubEntity, LocalScrubResult } from "../vault/wireBoundary";
import { byteSize } from "../vault/wireBoundary";
import { isLocalNanoReady, runLocalOnly, SCRUB_RESPONSE_CONSTRAINT } from "./modelFactory";
import { buildScrubPrompt, detectPromptInjection } from "./prompts";
import {
  addFirewallEntities,
  applyCandidates,
  extractLineItems,
  heuristicEntities,
  parseEntityCandidates,
  scrubWithSimulation,
} from "./simulationScrub";

export interface ScrubProgress {
  chunkIndex: number;
  chunkCount: number;
  entitiesFound: number;
  message: string;
}

export interface ScrubOptions {
  documentType: DocumentType;
  jurisdiction: string;
  redactionStrictness: "standard" | "strict";
  maxChunkChars: number;
  forceSimulation?: boolean;
  onProgress?: (progress: ScrubProgress) => void;
}

export interface LocalScrubOutcome extends LocalScrubResult {
  mode: "on_device" | "simulation";
  chunks: number;
  truncated: boolean;
  localLatencyMs: number;
  firewallHits: FirewallHit[];
  rawBytes: number;
  warnings: string[];
}

async function scrubChunkOnDevice(
  chunk: string,
  options: ScrubOptions,
  registry: TokenRegistry,
  entities: LocalScrubEntity[],
  chunkIndex: number,
  chunkCount: number
): Promise<{ text: string; usedDevice: boolean; warning?: string }> {
  const baseOptions = {
    documentType: options.documentType,
    strictness: options.redactionStrictness,
    chunkIndex,
    chunkCount,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await runLocalOnly(
        buildScrubPrompt(chunk, { ...baseOptions, retry: attempt > 0 }),
        SCRUB_RESPONSE_CONSTRAINT
      );
      const parsed = parseEntityCandidates(result.response.text());
      if (parsed !== null) {
        const modelApplied = applyCandidates(chunk, parsed, registry, entities, "device");
        // Defense in depth: labelled names/orgs/addresses are also swept even if
        // the model was manipulated into returning an empty entity list.
        const safetyNet = applyCandidates(
          modelApplied.text,
          heuristicEntities(chunk, options.documentType),
          registry,
          entities,
          "regex"
        );
        return { text: safetyNet.text, usedDevice: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown on-device error";
      if (message.startsWith("PRIVACY_VIOLATION")) {
        throw error;
      }
      if (attempt === 1) {
        const fallback = applyCandidates(
          chunk,
          heuristicEntities(chunk, options.documentType),
          registry,
          entities,
          "regex"
        );
        return {
          text: fallback.text,
          usedDevice: false,
          warning: "A chunk fell back to regex redaction because on-device inference failed.",
        };
      }
    }
  }

  const fallback = applyCandidates(
    chunk,
    heuristicEntities(chunk, options.documentType),
    registry,
    entities,
    "regex"
  );
  return {
    text: fallback.text,
    usedDevice: false,
    warning: "A chunk fell back to regex redaction because its model output was not valid JSON.",
  };
}

export async function scrubLocalDocument(
  rawText: string,
  options: ScrubOptions
): Promise<LocalScrubOutcome> {
  const started = Date.now();
  const baseWarnings: string[] = [];

  if (detectPromptInjection(rawText)) {
    baseWarnings.push(
      "Prompt-injection language detected inside the document. It was treated strictly as data and cannot disable the firewall."
    );
  }

  const nanoReady = !options.forceSimulation && (await isLocalNanoReady());

  if (!nanoReady) {
    if (options.forceSimulation) {
      baseWarnings.push(
        "Simulation Mode: structured IDs are caught by regex, but names and addresses rely on heuristics."
      );
    } else {
      baseWarnings.push(
        "Gemini Nano is unavailable, so Airlock used Simulation Mode. Structured IDs are caught locally; semantic coverage is weaker than on-device AI."
      );
    }
    const simulated = scrubWithSimulation(rawText, {
      documentType: options.documentType,
      maxChunkChars: options.maxChunkChars,
    });
    const warnings = [...new Set([...baseWarnings, ...simulated.warnings])];
    if (simulated.chunks === 0) warnings.push("The document was empty after trimming.");
    return {
      entities: simulated.entities,
      sanitizedText: simulated.sanitizedText,
      extractedItems: simulated.extractedItems,
      tokenMap: simulated.tokenMap,
      reverseMap: simulated.reverseMap,
      mode: "simulation",
      chunks: simulated.chunks,
      truncated: simulated.truncated,
      localLatencyMs: Date.now() - started,
      firewallHits: simulated.firewallHits,
      rawBytes: simulated.rawBytes,
      warnings,
    };
  }

  const warnings = [...baseWarnings];
  const entities: LocalScrubEntity[] = [];
  const registry = new TokenRegistry({}, rawText);
  const chunked = chunkText(rawText, { maxChars: options.maxChunkChars });

  if (chunked.truncated) {
    warnings.push(
      `Document truncated to ${chunked.chunks.length} chunks (${options.maxChunkChars} chars each). The tail was not analyzed.`
    );
  }
  if (chunked.chunks.length === 0) {
    return {
      entities: [],
      sanitizedText: "",
      extractedItems: [],
      tokenMap: registry.tokenMap,
      reverseMap: registry.reverseMap,
      mode: "simulation",
      chunks: 0,
      truncated: false,
      localLatencyMs: Date.now() - started,
      firewallHits: [],
      rawBytes: 0,
      warnings: [...warnings, "The document was empty after trimming."],
    };
  }

  const processed: string[] = [];
  let deviceChunks = 0;
  let fallbackChunks = 0;

  for (let index = 0; index < chunked.chunks.length; index += 1) {
    const chunk = chunked.chunks[index];
    options.onProgress?.({
      chunkIndex: index,
      chunkCount: chunked.chunks.length,
      entitiesFound: entities.length,
      message: `Scrubbing locally with Gemini Nano — chunk ${index + 1} of ${chunked.chunks.length}`,
    });

    const result = await scrubChunkOnDevice(
      chunk.text,
      options,
      registry,
      entities,
      index,
      chunked.chunks.length
    );
    processed.push(result.text);
    if (result.usedDevice) deviceChunks += 1;
    else fallbackChunks += 1;
    if (result.warning && !warnings.includes(result.warning)) warnings.push(result.warning);
  }

  const assembled = processed.join("");
  const firewalled = runPiiFirewall(assembled, registry.snapshot());
  registry.absorb(firewalled);

  const mode: LocalScrubOutcome["mode"] =
    fallbackChunks === 0 && deviceChunks > 0 ? "on_device" : "simulation";

  if (fallbackChunks > 0) {
    warnings.push(
      `${fallbackChunks} of ${chunked.chunks.length} chunk(s) used regex fallback; privacy coverage for those chunks is weaker.`
    );
  }

  return {
    entities: addFirewallEntities(entities, firewalled.hits),
    sanitizedText: firewalled.text,
    extractedItems: extractLineItems(rawText),
    tokenMap: registry.tokenMap,
    reverseMap: registry.reverseMap,
    mode,
    chunks: chunked.chunks.length,
    truncated: chunked.truncated,
    localLatencyMs: Date.now() - started,
    firewallHits: firewalled.hits,
    rawBytes: byteSize(rawText),
    warnings,
  };
}
