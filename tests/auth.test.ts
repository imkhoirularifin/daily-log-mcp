import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBearerToken, requireApiKey } from "../src/auth.js";
import { closeDb, initDb } from "../src/db.js";
import { resolveAuthUser, revokeApiKey } from "../src/users.js";
import { makeUser } from "./helpers.js";
import type { Request, Response } from "express";

describe("Bearer token extraction", () => {
  it("extracts token text", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("Token abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});

describe("key → user resolution", () => {
  beforeEach(() => {
    initDb(":memory:");
  });
  afterEach(() => {
    closeDb();
  });

  it("resolves a Bearer key to the linked user", () => {
    const { actor, rawKey } = makeUser({
      nama: "Alza",
      role: "Frontend",
      rawKey: "alza-secret-key",
    });
    const resolved = resolveAuthUser(rawKey);
    expect(resolved).toMatchObject({
      id: actor.id,
      nama: "Alza",
      role: "Frontend",
      isAdmin: false,
      apiKeyId: actor.apiKeyId,
    });
  });

  it("rejects unknown or revoked keys", () => {
    const { actor, rawKey } = makeUser({
      nama: "Temp",
      role: "Backend",
      rawKey: "will-revoke",
    });
    expect(resolveAuthUser("nope")).toBeNull();
    revokeApiKey(actor.apiKeyId);
    expect(resolveAuthUser(rawKey)).toBeNull();
  });

  it("requireApiKey attaches authUser", () => {
    const { rawKey } = makeUser({
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
      rawKey: "dori-key",
    });
    const req = {
      header: (name: string) =>
        name.toLowerCase() === "authorization" ? `Bearer ${rawKey}` : undefined,
    } as unknown as Request;
    const res = {
      status: (code: number) => {
        expect(code).toBe(401);
        return { json: () => undefined };
      },
    } as unknown as Response;
    let nextCalled = false;
    requireApiKey(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.authUser?.nama).toBe("Dori");
    expect(req.authUser?.isAdmin).toBe(true);
  });
});
