import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fail } from "../common/errors.ts";

export interface ParsedToken { id: string; secret: string; fingerprint: string }

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseToken(value: unknown, creating = false): ParsedToken {
  const match = typeof value === "string" && /^([A-Za-z0-9_-]{8,100})\.([A-Za-z0-9_-]{43,128})$/u.exec(value);
  if (!match) fail(creating ? "invalid_request" : "authentication_failed", creating ? 400 : 401, creating ? "Invalid credential material" : "Authentication failed");
  return { id: match[1]!, secret: match[2]!, fingerprint: sha256(match[2]!) };
}

export function verifier(kind: string, token: ParsedToken): string {
  return sha256(`connet-m1:${kind}:${token.id}:${token.secret}`);
}

export function equalDigest(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function hashPassword(value: unknown): { salt: string; hash: string } {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) {
    fail("invalid_request", 400, "Password must contain 12 to 256 characters", { field: "password" });
  }
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: passwordDigest(value, salt) };
}

function passwordDigest(value: string, salt: string): string {
  return scryptSync(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
}

export function checkPassword(value: unknown, salt: string, digest: string): boolean {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) return false;
  return equalDigest(passwordDigest(value, salt), digest);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function payloadHash(value: unknown): string {
  return sha256(JSON.stringify(canonical(value)));
}
