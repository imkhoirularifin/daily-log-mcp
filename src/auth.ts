import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "./types.js";
import { resolveAuthUser } from "./users.js";

export function extractBearerToken(
  authorization: string | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
}

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthUser;
  }
}

/**
 * Express middleware: resolve Bearer token → AuthUser from hashed api_keys.
 * Does not log or echo key values.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.header("authorization") ?? undefined);
  if (!token) {
    res.status(401).json({
      error: "unauthorized",
      message:
        "Missing or invalid Authorization header. Use: Authorization: Bearer <API_KEY>",
    });
    return;
  }

  const user = resolveAuthUser(token);
  if (!user) {
    res.status(401).json({
      error: "unauthorized",
      message:
        "Missing or invalid Authorization header. Use: Authorization: Bearer <API_KEY>",
    });
    return;
  }

  req.authUser = user;
  next();
}
