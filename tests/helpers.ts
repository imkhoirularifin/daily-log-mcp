import { createApiKey, createUser, ensureUser } from "../src/users.js";
import type { AuthUser } from "../src/types.js";

export function makeUser(opts: {
  nama: string;
  role: string;
  isAdmin?: boolean;
  keyLabel?: string;
  rawKey?: string;
}): { actor: AuthUser; rawKey: string } {
  const user = createUser({
    nama: opts.nama,
    role: opts.role,
    isAdmin: opts.isAdmin ?? false,
  });
  const { key, rawKey } = createApiKey({
    userId: user.id,
    label: opts.keyLabel ?? `${opts.nama}-test`,
    rawKey: opts.rawKey,
  });
  return {
    rawKey,
    actor: {
      id: user.id,
      nama: user.nama,
      role: user.role,
      isAdmin: user.is_admin === 1,
      apiKeyId: key.id,
    },
  };
}

/** Ensure Arifin exists (migration may already create them) and issue a key. */
export function makeArifin(rawKey = "test-key-arifin"): {
  actor: AuthUser;
  rawKey: string;
} {
  const user = ensureUser({
    nama: "Arifin",
    role: "Backend",
    isAdmin: false,
  });
  const { key, rawKey: issued } = createApiKey({
    userId: user.id,
    label: "arifin-test",
    rawKey,
  });
  return {
    rawKey: issued,
    actor: {
      id: user.id,
      nama: user.nama,
      role: user.role,
      isAdmin: false,
      apiKeyId: key.id,
    },
  };
}
