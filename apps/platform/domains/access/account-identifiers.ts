import { fail } from "../common/errors.ts";

export function username(value: unknown): { username: string; usernameKey: string } {
  if (typeof value !== "string") fail("invalid_request", 400, "Invalid username", { field: "username" });
  const normalized = value.trim().normalize("NFKC");
  const length = [...normalized].length;
  if (length < 2 || length > 32 || !/^[A-Za-z0-9_]+$/u.test(normalized)) {
    fail("invalid_request", 400, "Username must contain 2 to 32 ASCII letters, digits or underscores", { field: "username" });
  }
  return { username: normalized, usernameKey: normalized.toLowerCase() };
}

export function email(value: unknown): { email: string; emailKey: string } {
  if (typeof value !== "string") fail("invalid_request", 400, "Invalid email", { field: "email" });
  const normalized = value.trim();
  const parts = normalized.split("@");
  const local = parts[0] ?? "", domain = parts[1] ?? "";
  const labels = domain.split(".");
  if (normalized.length > 254 || parts.length !== 2 || local.length < 1 || local.length > 64
      || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/u.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")
      || labels.length < 2 || labels.some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label))
      || !/[A-Za-z]/u.test(labels.at(-1) ?? "")) {
    fail("invalid_request", 400, "Invalid email", { field: "email" });
  }
  return { email: normalized, emailKey: normalized.toLowerCase() };
}

export function accountFields(name: unknown, address: unknown) {
  return { ...username(name), ...email(address), emailVerified: false };
}

export function loginIdentifier(value: unknown): { field: "usernameKey" | "emailKey"; key: string } {
  try {
    if (typeof value !== "string") throw new Error("Invalid identifier");
    return value.trim().includes("@") ? { field: "emailKey", key: email(value).emailKey } : { field: "usernameKey", key: username(value).usernameKey };
  } catch { fail("authentication_failed", 401, "Authentication failed"); }
}
