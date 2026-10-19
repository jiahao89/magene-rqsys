import { describe, expect, it } from "vitest";
import { readRequirementDeepLink } from "./deep-link";

const REQUIREMENT_ID = "11111111-2222-4333-8444-555555555555";

describe("readRequirementDeepLink", () => {
  it("reads a normal requirement parameter", () => {
    expect(readRequirementDeepLink(`?requirement=${REQUIREMENT_ID}`)).toBe(REQUIREMENT_ID);
  });

  it("returns null when the parameter is missing", () => {
    expect(readRequirementDeepLink("")).toBeNull();
    expect(readRequirementDeepLink("?foo=bar")).toBeNull();
    expect(readRequirementDeepLink("?requirements=other")).toBeNull();
  });

  it("returns null for an empty or whitespace-only value", () => {
    expect(readRequirementDeepLink("?requirement=")).toBeNull();
    expect(readRequirementDeepLink("?requirement=%20%20")).toBeNull();
  });

  it("ignores extra parameters and unrelated fragments", () => {
    expect(readRequirementDeepLink(`?foo=1&requirement=${REQUIREMENT_ID}&bar=2`)).toBe(REQUIREMENT_ID);
  });

  it("decodes percent-encoded values and keeps the first occurrence", () => {
    expect(readRequirementDeepLink("?requirement=req%2D1")).toBe("req-1");
    expect(readRequirementDeepLink("?requirement=%E9%9C%80%E6%B1%82%2F1")).toBe("需求/1");
    expect(readRequirementDeepLink(`?requirement=first&requirement=second`)).toBe("first");
  });
});
