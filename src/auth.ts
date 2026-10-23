import type { Request, Response, NextFunction } from "express";

/** Parse MCP_API_KEY env (comma-separated) into a Set of valid tokens. */
export function getApiKeys(envValue = process.env.MCP_API_KEY): Set<string> {
  if (!envValue || !envValue.trim()) {
    return new Set();
  }
  return new Set(
    envValue
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

export function extractBearerToken(
  authorization: string | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
}

export function isAuthorized(
  authorization: string | undefined,
  keys = getApiKeys(),
): boolean {
  if (keys.size === 0) return false;
  const token = extractBearerToken(authorization);
  if (!token) return false;
  return keys.has(token);
}

/** Express middleware: require Bearer token matching MCP_API_KEY. */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (isAuthorized(req.header("authorization") ?? undefined)) {
    next();
    return;
  }
  res.status(401).json({
    error: "unauthorized",
    message:
      "Missing or invalid Authorization header. Use: Authorization: Bearer <MCP_API_KEY>",
  });
}
