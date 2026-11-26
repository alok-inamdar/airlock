/** Deterministic clause/line-aware chunker for on-device context windows. */

export interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ChunkResult {
  chunks: Chunk[];
  truncated: boolean;
  totalChars: number;
  maxChars: number;
  maxChunks: number;
}

export interface ChunkOptions {
  maxChars?: number;
  maxChunks?: number;
}

export const DEFAULT_MAX_CHARS = 1600;
export const DEFAULT_MAX_CHUNKS = 20;

function safeCut(text: string, cut: number): number {
  let value = cut;
  if (value <= 0) return value;
  const previous = text.charCodeAt(value - 1);
  const next = text.charCodeAt(value);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    value -= 1;
  }
  return value;
}

function findBoundary(text: string, start: number, end: number, maxChars: number): number {
  if (end >= text.length) return text.length;
  const floor = start + Math.max(40, Math.floor(maxChars * 0.55));

  const paragraph = text.lastIndexOf("\n\n", end);
  if (paragraph >= floor && paragraph + 2 <= end) return safeCut(text, paragraph + 2);

  const newline = text.lastIndexOf("\n", end);
  if (newline >= floor && newline + 1 <= end) return safeCut(text, newline + 1);

  const window = text.slice(floor, end);
  const sentencePattern = /[.!?]["')\]]?\s+/g;
  let sentenceCut = -1;
  let sentenceMatch = sentencePattern.exec(window);
  while (sentenceMatch) {
    const nextIndex = sentenceMatch.index + sentenceMatch[0].length;
    const nextChar = window[nextIndex] ?? "";
    if (nextChar === "" || /[A-Z0-9"']/.test(nextChar)) {
      sentenceCut = sentenceMatch.index;
    }
    sentenceMatch = sentencePattern.exec(window);
  }
  if (sentenceCut !== -1) {
    return safeCut(text, floor + sentenceCut + 1);
  }

  const space = text.lastIndexOf(" ", end);
  if (space >= floor) return safeCut(text, space + 1);

  return safeCut(text, end);
}

/**
 * Split `text` into chunks of at most `maxChars` characters. When the document
 * is within limits, `chunks.map(c => c.text).join("") === text` exactly.
 */
export function chunkText(text: string, options: ChunkOptions = {}): ChunkResult {
  const maxChars = Math.max(20, options.maxChars ?? DEFAULT_MAX_CHARS);
  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
  const totalChars = text.length;

  if (totalChars === 0) {
    return { chunks: [], truncated: false, totalChars, maxChars, maxChunks };
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < totalChars && chunks.length < maxChunks) {
    const hardEnd = Math.min(start + maxChars, totalChars);
    const end = findBoundary(text, start, hardEnd, maxChars);
    if (end <= start) break;
    chunks.push({
      index: chunks.length,
      start,
      end,
      text: text.slice(start, end),
    });
    start = end;
  }

  return {
    chunks,
    truncated: start < totalChars,
    totalChars,
    maxChars,
    maxChunks,
  };
}

export function countChunks(text: string, options: ChunkOptions = {}): number {
  return chunkText(text, options).chunks.length;
}
