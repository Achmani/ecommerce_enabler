import type { ApiFailure, ApiSuccess } from "../shared/types";

export class ApiClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(path, { ...options, headers });
  const raw: unknown = await response.json();
  if (!isRecord(raw)) throw new ApiClientError("invalid_response", "Server returned an invalid response");
  const payload = raw as ApiSuccess<T> | ApiFailure;
  if (!response.ok || "error" in payload) {
    const failure = payload as ApiFailure;
    throw new ApiClientError(failure.error.code, failure.error.message, failure.error.details);
  }
  return payload.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}
