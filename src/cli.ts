#!/usr/bin/env node
/**
 * Operator CLI for users + API keys.
 *
 * Examples (inside container):
 *   node dist/cli.js user add --nama Alza --role Frontend
 *   node dist/cli.js user list
 *   node dist/cli.js key create --user Alza --label alza-claude
 *   node dist/cli.js key list
 *   node dist/cli.js key revoke --id <key-uuid>
 *
 * Never prints existing key material — only a newly created key once.
 */
import { closeDb, getDatabasePath, initDb } from "./db.js";
import {
  createApiKey,
  createUser,
  findUserByNama,
  listApiKeys,
  listUsers,
  revokeApiKey,
} from "./users.js";
import { ValidationError } from "./validation.js";

function usage(): never {
  console.log(`Usage:
  node dist/cli.js user add --nama <Nama> --role <Role> [--admin]
  node dist/cli.js user list
  node dist/cli.js key create --user <Nama> --label <label>
  node dist/cli.js key list [--user <Nama>]
  node dist/cli.js key revoke --id <key-uuid>

Environment: DATABASE_PATH (default /data/daily-log.db)
`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: string;
  sub: string;
  flags: Record<string, string | boolean>;
} {
  const [command, sub, ...rest] = argv;
  if (!command || !sub) usage();
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--admin") {
      flags.admin = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = rest[i + 1];
      if (!val || val.startsWith("--")) {
        console.error(`Missing value for --${key}`);
        usage();
      }
      flags[key] = val;
      i += 1;
      continue;
    }
    console.error(`Unexpected argument: ${a}`);
    usage();
  }
  return { command, sub, flags };
}

function flagString(
  flags: Record<string, string | boolean>,
  name: string,
): string {
  const v = flags[name];
  if (typeof v !== "string" || !v.trim()) {
    console.error(`Missing required --${name}`);
    usage();
  }
  return v.trim();
}

function main(): void {
  const { command, sub, flags } = parseArgs(process.argv.slice(2));
  const dbPath = getDatabasePath();
  initDb(dbPath);

  try {
    if (command === "user" && sub === "add") {
      const nama = flagString(flags, "nama");
      const role = flagString(flags, "role");
      const isAdmin = flags.admin === true;
      const user = createUser({ nama, role, isAdmin });
      console.log(
        JSON.stringify(
          {
            ok: true,
            user: {
              id: user.id,
              nama: user.nama,
              role: user.role,
              isAdmin: user.is_admin === 1,
              created_at: user.created_at,
            },
          },
          null,
          2,
        ),
      );
    } else if (command === "user" && sub === "list") {
      console.log(JSON.stringify({ ok: true, users: listUsers() }, null, 2));
    } else if (command === "key" && sub === "create") {
      const nama = flagString(flags, "user");
      const label = flagString(flags, "label");
      const user = findUserByNama(nama);
      if (!user) {
        throw new ValidationError(
          `User "${nama}" tidak ditemukan. Buat dulu: user add --nama ${nama} --role <Role>`,
        );
      }
      const { key, rawKey } = createApiKey({ userId: user.id, label });
      console.log(
        JSON.stringify(
          {
            ok: true,
            message:
              "Store this API key now — it will not be shown again. Put it in the client Authorization: Bearer header.",
            key: {
              id: key.id,
              user: user.nama,
              label: key.label,
              created_at: key.created_at,
              api_key: rawKey,
            },
          },
          null,
          2,
        ),
      );
    } else if (command === "key" && sub === "list") {
      let userId: string | undefined;
      if (typeof flags.user === "string") {
        const user = findUserByNama(flags.user);
        if (!user) {
          throw new ValidationError(`User "${flags.user}" tidak ditemukan.`);
        }
        userId = user.id;
      }
      const keys = listApiKeys(userId);
      // Never include key hashes in CLI list output (defense in depth).
      console.log(JSON.stringify({ ok: true, keys }, null, 2));
    } else if (command === "key" && sub === "revoke") {
      const id = flagString(flags, "id");
      const key = revokeApiKey(id);
      console.log(
        JSON.stringify(
          {
            ok: true,
            key: {
              id: key.id,
              label: key.label,
              revoked_at: key.revoked_at,
            },
          },
          null,
          2,
        ),
      );
    } else {
      usage();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

main();
