import { describe, expect, it } from "vitest";
import { rehydrateText } from "../vault/rehydrate";
import { TokenRegistry } from "../vault/tokenMap";

describe("rehydrate", () => {
  it("round-trips a tokenized document", () => {
    const registry = new TokenRegistry({}, "Rohan Sharma met Mira Patel at 44 Beacon Street.");
    const patient = registry.register("Rohan Sharma", "PERSON");
    const landlord = registry.register("Mira Patel", "PERSON");
    const address = registry.register("44 Beacon Street", "ADDRESS");
    expect(patient).toBe("[PERSON_1]");
    expect(landlord).toBe("[PERSON_2]");
    expect(address).toBe("[ADDRESS_1]");

    const tokenized = `${patient} met ${landlord} at ${address}.`;
    const result = rehydrateText(tokenized, registry.snapshot().tokenMap);

    expect(result.text).toBe("Rohan Sharma met Mira Patel at 44 Beacon Street.");
    expect(result.replaced).toBe(3);
    expect(result.unknownTokens).toHaveLength(0);
  });

  it("replaces longest tokens first so [PATIENT_1] cannot corrupt [PATIENT_10]", () => {
    const tokenMap = {
      "[PATIENT_1]": "Rohan Sharma",
      "[PATIENT_10]": "Mira Patel",
    };
    const result = rehydrateText("[PATIENT_10] then [PATIENT_1]", tokenMap);

    expect(result.text).toBe("Mira Patel then Rohan Sharma");
    expect(result.text).not.toContain("Sharma0");
  });

  it("leaves unknown tokens untouched", () => {
    const result = rehydrateText("Hello [PERSON_1], this is [UNKNOWN_9].", {
      "[PERSON_1]": "Rohan Sharma",
    });

    expect(result.text).toBe("Hello Rohan Sharma, this is [UNKNOWN_9].");
    expect(result.unknownTokens).toEqual(["[UNKNOWN_9]"]);
  });

  it("leaves literal source brackets untouched", () => {
    const result = rehydrateText("See [NOTE] and [SECTION_2] but not [PERSON_1].", {
      "[PERSON_1]": "Rohan Sharma",
    });

    expect(result.text).toBe("See [NOTE] and [SECTION_2] but not Rohan Sharma.");
    expect(result.unknownTokens).toEqual(["[SECTION_2]"]);
  });

  it("ignores malformed or empty token map entries", () => {
    const result = rehydrateText("[PERSON_1] [lower_1] [BAD]", {
      "[PERSON_1]": "Rohan Sharma",
      "[lower_1]": "lowercase token",
      "[BAD]": "missing counter",
      "[EMPTY_1]": "",
    });

    expect(result.text).toBe("Rohan Sharma [lower_1] [BAD]");
    expect(result.unknownTokens).toEqual([]);
  });

  it("does not recurse into replacement values", () => {
    const result = rehydrateText("[A_1] [B_1]", {
      "[A_1]": "[B_1]",
      "[B_1]": "expanded",
    });

    expect(result.text).toBe("[B_1] expanded");
  });

  it("reports no unknown tokens for a fully validated map", () => {
    const result = rehydrateText("SSN [REDACTED_REGEX_1], email [REDACTED_REGEX_2]", {
      "[REDACTED_REGEX_1]": "000-00-0000",
      "[REDACTED_REGEX_2]": "jane@example.com",
    });

    expect(result.text).toBe("SSN 000-00-0000, email jane@example.com");
    expect(result.unknownTokens).toHaveLength(0);
  });
});
