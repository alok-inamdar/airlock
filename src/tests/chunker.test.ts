import { describe, expect, it } from "vitest";
import { chunkText, countChunks, DEFAULT_MAX_CHARS } from "../vault/chunker";
import { LEASE_SAMPLE } from "../samples/leaseSample";

describe("chunker", () => {
  it("preserves the document exactly when it is within limits", () => {
    const result = chunkText(LEASE_SAMPLE, { maxChars: 400 });
    expect(result.chunks.map((chunk) => chunk.text).join("")).toBe(LEASE_SAMPLE);
    expect(result.truncated).toBe(false);
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("never exceeds the maximum chunk size", () => {
    const result = chunkText(LEASE_SAMPLE, { maxChars: 300 });
    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(300);
    }
  });

  it("prefers paragraph boundaries over hard cuts", () => {
    const text = `${"A".repeat(300)}\n\n${"B".repeat(300)}\n\n${"C".repeat(300)}`;
    const result = chunkText(text, { maxChars: 500 });

    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.chunks[0].text.endsWith("\n\n")).toBe(true);
    expect(result.chunks[0].text.length).toBeLessThanOrEqual(500);
    expect(result.chunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("hard-cuts a long unbroken string without losing characters", () => {
    const text = "x".repeat(1000);
    const result = chunkText(text, { maxChars: 180 });

    expect(result.chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(Math.max(...result.chunks.map((chunk) => chunk.text.length))).toBeLessThanOrEqual(180);
  });

  it("truncates at the chunk cap and reports it", () => {
    const text = "word ".repeat(2000);
    const result = chunkText(text, { maxChars: 200, maxChunks: 3 });

    expect(result.chunks).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.chunks.map((chunk) => chunk.text).join("")).not.toBe(text);
  });

  it("returns no chunks for empty input", () => {
    const result = chunkText("", { maxChars: 200 });
    expect(result.chunks).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(countChunks("", { maxChars: 200 })).toBe(0);
  });

  it("does not split surrogate pairs", () => {
    const text = "🛡️".repeat(200);
    const result = chunkText(text, { maxChars: 50 });

    for (const chunk of result.chunks) {
      const first = chunk.text.charCodeAt(0);
      const last = chunk.text.charCodeAt(chunk.text.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(result.chunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("defaults to 1,600 characters and 20 chunks", () => {
    const result = chunkText("a ".repeat(30_000));
    expect(result.maxChars).toBe(DEFAULT_MAX_CHARS);
    expect(result.maxChunks).toBe(20);
    expect(result.chunks.length).toBe(20);
    expect(result.truncated).toBe(true);
  });
});
