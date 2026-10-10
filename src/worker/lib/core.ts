import type { Context } from "hono";
import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export type AppVariables = {
  requestId: string;
  adminEmail: string;
};

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};

export function requestId(c: Context<AppBindings>): string {
  return c.get("requestId");
}

export function success<T>(c: Context<AppBindings>, data: T, status: 200 | 201 | 202 = 200) {
  return c.json({ data, requestId: requestId(c) }, status);
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, "validation_failed", "Request data is invalid", result.error.flatten());
  }
  return result.data;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

export function asPositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function safeJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

