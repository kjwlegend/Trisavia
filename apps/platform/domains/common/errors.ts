export class M1Error extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "M1Error";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function fail(code: string, status: number, message: string, details?: Record<string, unknown>): never {
  throw new M1Error(code, status, message, details);
}

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_request", 400, "Expected a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    fail("invalid_request", 400, "Unexpected request field");
  }
  return record;
}

export function text(value: unknown, field: string, min = 1, max = 100): string {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("invalid_request", 400, "Invalid field", { field });
  }
  return value;
}

export function version(value: unknown, field = "expectedVersion"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("invalid_request", 400, "Invalid version", { field });
  }
  return value as number;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail("invalid_request", 400, "Invalid field", { field });
  return value;
}
