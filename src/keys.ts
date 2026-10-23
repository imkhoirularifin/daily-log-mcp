import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex digest of an API key (for storage / lookup). Never log the raw key. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** Generate a new high-entropy API key (printed once to the operator). */
export function generateApiKey(): string {
  return `dlk_${randomBytes(32).toString("base64url")}`;
}
