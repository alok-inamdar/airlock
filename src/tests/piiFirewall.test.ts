import { describe, expect, it } from "vitest";
import {
  detectPii,
  firewallPassed,
  runPiiFirewall,
} from "../vault/piiFirewall";
import { rehydrateText } from "../vault/rehydrate";

describe("piiFirewall", () => {
  it("redacts every supported structured direct identifier", () => {
    const text = [
      "SSN: 000-00-0000",
      "Email: jane.doe@example.com",
      "Phone: (415) 555-0134",
      "DOB: 03/14/1979",
      "MRN: MG-8842197",
      "Aadhaar: 2345 6789 0123",
      "PAN: ABCDE1234F",
      "Routing Number: 123456789",
      "Account Number: 4471 8820 1193",
      "Card on file: 4111 1111 1111 1111",
    ].join("\n");

    const result = runPiiFirewall(text);
    const categories = new Set(result.hits.map((hit) => hit.category));

    expect(categories).toEqual(
      new Set(["SSN", "EMAIL", "PHONE", "DOB", "MRN", "AADHAAR", "PAN", "BANK", "CARD"])
    );
    expect(result.text).not.toContain("000-00-0000");
    expect(result.text).not.toContain("jane.doe@example.com");
    expect(result.text).not.toContain("(415) 555-0134");
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(firewallPassed(result.text)).toBe(true);
    expect(detectPii(result.text)).toHaveLength(0);
  });

  it("does not redact CPT codes, NDC codes, or dollar amounts", () => {
    const text =
      "CPT 99284 Emergency department visit $1,450.00; CPT 36415 $85.00; NDC 00093-0148-01; total $4,820.00.";
    const result = runPiiFirewall(text);

    expect(result.hits).toHaveLength(0);
    expect(result.text).toBe(text);
    expect(result.text).toContain("99284");
    expect(result.text).toContain("36415");
    expect(result.text).toContain("$4,820.00");
  });

  it("reuses one deterministic token for repeated values", () => {
    const text = "Email jane@example.com and again JANE@EXAMPLE.COM or jane@example.com";
    const result = runPiiFirewall(text);

    expect(result.hits).toHaveLength(3);
    expect(new Set(result.hits.map((hit) => hit.token)).size).toBe(1);
    expect(result.text).not.toContain("@example.com");
  });

  it("adds redacted originals to the local token map so rehydration is lossless", () => {
    const text = "Contact jane@example.com or (415) 555-0134. SSN 000-00-0000.";
    const result = runPiiFirewall(text);
    const restored = rehydrateText(result.text, result.tokenMap);

    expect(restored.text).toBe(text);
    expect(restored.unknownTokens).toHaveLength(0);
  });

  it("is idempotent on already-tokenized text", () => {
    const first = runPiiFirewall("SSN 000-00-0000");
    const second = runPiiFirewall(first.text, {
      tokenMap: first.tokenMap,
      reverseMap: first.reverseMap,
    });

    expect(second.hits).toHaveLength(0);
    expect(second.text).toBe(first.text);
    expect(second.tokenMap).toEqual(first.tokenMap);
  });

  it("keeps a 10-digit phone out of CPT-like five-digit sequences", () => {
    const text = "Claim 12345 was denied. Call 4155550134 for help.";
    const result = runPiiFirewall(text);

    expect(result.text).toContain("12345");
    expect(result.text).not.toContain("4155550134");
  });
});
