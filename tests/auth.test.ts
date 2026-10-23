import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  getApiKeys,
  isAuthorized,
} from "../src/auth.js";

describe("API key parsing", () => {
  it("splits comma-separated keys and trims", () => {
    const keys = getApiKeys(" alpha ,beta, gamma ");
    expect(keys.has("alpha")).toBe(true);
    expect(keys.has("beta")).toBe(true);
    expect(keys.has("gamma")).toBe(true);
    expect(keys.size).toBe(3);
  });

  it("returns empty set when unset", () => {
    expect(getApiKeys("").size).toBe(0);
    expect(getApiKeys(undefined).size).toBe(0);
  });
});

describe("Bearer auth", () => {
  const keys = getApiKeys("secret-a,secret-b");

  it("accepts a matching Bearer token", () => {
    expect(isAuthorized("Bearer secret-a", keys)).toBe(true);
    expect(isAuthorized("bearer secret-b", keys)).toBe(true);
  });

  it("rejects missing, malformed, or wrong tokens", () => {
    expect(isAuthorized(undefined, keys)).toBe(false);
    expect(isAuthorized("", keys)).toBe(false);
    expect(isAuthorized("Basic secret-a", keys)).toBe(false);
    expect(isAuthorized("Bearer wrong", keys)).toBe(false);
    expect(isAuthorized("Bearer secret-a", getApiKeys(""))).toBe(false);
  });

  it("extracts token text", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("Token abc")).toBeNull();
  });
});
