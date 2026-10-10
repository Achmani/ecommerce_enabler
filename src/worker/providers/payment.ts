import type { AuthoritativeCart } from "../lib/cart";
import { ApiError, addSeconds, safeJson } from "../lib/core";
import { timingSafeEqual } from "node:crypto";

export type PaymentCreation = {
  provider: "mock" | "komerce";
  providerPaymentId: string;
  paymentReference: string | null;
  checkoutUrl: string | null;
  qrString: string | null;
  expiresAt: string;
};

type PaymentCustomer = {
  name: string;
  email: string;
  phone: string;
};

export async function createPayment(
  env: Env,
  orderId: string,
  orderNumber: string,
  amount: number,
  shippingCost: number,
  cart: AuthoritativeCart,
  customer: PaymentCustomer
): Promise<PaymentCreation> {
  const expiresAt = addSeconds(new Date(), 3600);
  if (env.ENVIRONMENT !== "production" && !env.KOMERCE_PAYMENT_API_KEY) {
    return {
      provider: "mock",
      providerPaymentId: `mock-${orderId}`,
      paymentReference: orderNumber,
      checkoutUrl: null,
      qrString: null,
      expiresAt
    };
  }
  if (!env.KOMERCE_PAYMENT_API_KEY || !env.KOMERCE_CHANNEL_CODE) {
    throw new ApiError(503, "payment_not_configured", "Payment provider is not configured");
  }

  const items = cart.items.map((item) => ({
    name: `${item.productName} — ${item.variantName}`,
    quantity: item.quantity,
    price: item.unitPrice
  }));
  if (shippingCost > 0) items.push({ name: "Ongkos Kirim", quantity: 1, price: shippingCost });

  const baseUrl = env.ENVIRONMENT === "production"
    ? "https://api.collaborator.komerce.id/user"
    : "https://api-sandbox.collaborator.komerce.id/user";
  const response = await fetch(`${baseUrl}/api/v1/user/payment/create`, {
    method: "POST",
    headers: {
      "x-api-key": env.KOMERCE_PAYMENT_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      order_id: orderNumber,
      payment_type: env.KOMERCE_PAYMENT_TYPE,
      channel_code: env.KOMERCE_CHANNEL_CODE,
      amount,
      customer,
      items,
      expiry_duration: 3600,
      callback_url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/payments/komerce/callback`,
      callback_api_key: env.KOMERCE_CALLBACK_SECRET
    })
  });

  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new ApiError(502, "payment_creation_failed", `Payment provider rejected the transaction (${status})`);
  }

  const payload: unknown = await response.json();
  const providerPaymentId = findString(payload, ["transaction_id", "payment_id", "id"]);
  if (!providerPaymentId) {
    throw new ApiError(502, "payment_response_invalid", "Payment provider returned an invalid transaction response");
  }
  return {
    provider: "komerce",
    providerPaymentId,
    paymentReference: findString(payload, ["reference", "order_id", "invoice_number"]),
    checkoutUrl: findString(payload, ["checkout_url", "payment_url", "redirect_url"]),
    qrString: findString(payload, ["qr_string", "qr_code", "qr_content", "qris_string"]),
    expiresAt: findString(payload, ["expires_at", "expiry_time", "expired_at"]) ?? expiresAt
  };
}

export type CallbackEvent = {
  providerPaymentId: string;
  providerOrderId: string | null;
  status: "paid" | "expired" | "failed" | "cancelled" | "pending";
  deduplicationKey: string;
};

export async function parseAndVerifyKomerceCallback(
  rawBody: string,
  signature: string,
  secret: string
): Promise<CallbackEvent> {
  if (!signature) throw new ApiError(401, "callback_signature_missing", "Callback signature is missing");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const provided = decodeSignature(signature);
  const padded = new Uint8Array(expected.length);
  padded.set(provided.slice(0, expected.length));
  if (provided.length !== expected.length || !timingSafeEqual(expected, padded)) {
    throw new ApiError(401, "callback_signature_invalid", "Callback signature is invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "callback_json_invalid", "Callback body is invalid JSON");
  }
  const providerPaymentId = findString(payload, ["transaction_id", "payment_id", "id"]);
  if (!providerPaymentId) {
    throw new ApiError(422, "callback_payment_missing", "Callback does not identify a payment");
  }
  const rawStatus = (findString(payload, ["transaction_status", "payment_status", "status"]) ?? "pending").toLowerCase();
  const status = normalizeStatus(rawStatus);
  const providerEventId = findString(payload, ["event_id", "callback_id"]);
  return {
    providerPaymentId,
    providerOrderId: findString(payload, ["order_id", "invoice_number"]),
    status,
    deduplicationKey: providerEventId ?? `${status}:${providerPaymentId}`
  };
}

export function sanitizeProviderResponse(value: unknown): string {
  if (!isRecord(value)) return "{}";
  return safeJson({
    status: findString(value, ["status", "payment_status", "transaction_status"]),
    reference: findString(value, ["reference", "order_id", "invoice_number"])
  });
}

function normalizeStatus(status: string): CallbackEvent["status"] {
  if (["paid", "success", "successful", "settlement", "completed"].includes(status)) return "paid";
  if (["expired", "expire"].includes(status)) return "expired";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["failed", "failure", "deny", "denied"].includes(status)) return "failed";
  return "pending";
}

function findString(value: unknown, keys: string[]): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  for (const candidate of Object.values(value)) {
    const found = findString(candidate, keys);
    if (found) return found;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSignature(signature: string): Uint8Array {
  const normalized = signature.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  }
  try {
    return Uint8Array.from(atob(normalized.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
