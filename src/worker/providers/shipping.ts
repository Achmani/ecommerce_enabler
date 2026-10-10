import type { Destination, ShippingQuote } from "../../shared/types";
import type { ShippingQuoteRequest } from "../../shared/schemas";
import { resolveCart } from "../lib/cart";
import { addSeconds, ApiError, asPositiveInteger, nowIso } from "../lib/core";

type ProviderQuote = Omit<ShippingQuote, "id" | "expiresAt">;

type ProviderJson = {
  data?: unknown;
  meta?: { message?: string };
};

export async function searchDestinations(env: Env, query: string): Promise<Destination[]> {
  if (env.ENVIRONMENT !== "production" && !env.RAJAONGKIR_API_KEY) {
    return [
      { id: "mock-jakarta-10110", label: `Jakarta Pusat — ${query}`, province: "DKI Jakarta", city: "Jakarta Pusat", postalCode: "10110" },
      { id: "mock-bandung-40111", label: `Bandung — ${query}`, province: "Jawa Barat", city: "Bandung", postalCode: "40111" }
    ];
  }

  const url = new URL("https://rajaongkir.komerce.id/api/v1/destination/domestic-destination");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");
  const response = await fetch(url, { headers: { key: env.RAJAONGKIR_API_KEY } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(502, "shipping_destination_failed", "Could not search delivery destinations");
  }
  const payload: ProviderJson = await response.json();
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): Destination[] => {
    if (!isRecord(item)) return [];
    const id = stringOrNumber(item.id);
    const label = stringValue(item.label);
    if (!id || !label) return [];
    return [{
      id,
      label,
      province: stringValue(item.province),
      city: stringValue(item.city),
      district: stringValue(item.district),
      subdistrict: stringValue(item.subdistrict),
      postalCode: stringValue(item.zip_code)
    }];
  });
}

export async function createShippingQuotes(
  env: Env,
  input: ShippingQuoteRequest
): Promise<ShippingQuote[]> {
  const cart = await resolveCart(env.DB, input.items);
  const configuredMinimum = asPositiveInteger(env.MINIMUM_PACKAGE_WEIGHT_GRAMS, 1000);
  const chargeableWeight = Math.max(configuredMinimum, cart.totalWeightGrams);
  const providerQuotes = await fetchProviderQuotes(env, input.destinationId, chargeableWeight);
  const timestamp = nowIso();
  const expiresAt = addSeconds(new Date(), Math.min(asPositiveInteger(env.SHIPPING_QUOTE_TTL_SECONDS, 900), 1800));

  const quotes = providerQuotes.map((quote) => ({ ...quote, id: crypto.randomUUID(), expiresAt }));
  if (quotes.length === 0) {
    throw new ApiError(422, "shipping_route_unavailable", "No courier service is available for this destination");
  }
  await env.DB.batch(quotes.map((quote) => env.DB.prepare(
    `INSERT INTO shipping_quotes
     (id, destination_id, destination_label, courier_code, courier_name, service_code,
      service_description, cost, etd, total_weight_grams, cart_fingerprint, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    quote.id, input.destinationId, input.destinationLabel, quote.courierCode, quote.courierName,
    quote.serviceCode, quote.serviceDescription, quote.cost, quote.etd, chargeableWeight,
    cart.fingerprint, expiresAt, timestamp
  )));
  return quotes;
}

async function fetchProviderQuotes(env: Env, destinationId: string, weightGrams: number): Promise<ProviderQuote[]> {
  if (env.ENVIRONMENT !== "production" && (!env.RAJAONGKIR_API_KEY || destinationId.startsWith("mock-"))) {
    return [
      { courierCode: "mock-jne", courierName: "JNE", serviceCode: "REG", serviceDescription: "Regular", cost: 18000, etd: "2-3 day" },
      { courierCode: "mock-sicepat", courierName: "SiCepat", serviceCode: "BEST", serviceDescription: "Besok Sampai Tujuan", cost: 26000, etd: "1 day" }
    ];
  }
  if (!env.STORE_ORIGIN_DESTINATION_ID) {
    throw new ApiError(503, "shipping_origin_missing", "Store shipping origin is not configured");
  }

  const form = new URLSearchParams({
    origin: env.STORE_ORIGIN_DESTINATION_ID,
    destination: destinationId,
    weight: String(weightGrams),
    courier: "jne:sicepat:jnt:ninja:tiki:anteraja:pos",
    price: "lowest"
  });
  const response = await fetch("https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost", {
    method: "POST",
    headers: {
      key: env.RAJAONGKIR_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(502, "shipping_quote_failed", "Could not calculate shipping fees");
  }
  const payload: ProviderJson = await response.json();
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): ProviderQuote[] => {
    if (!isRecord(item)) return [];
    const cost = numberValue(item.cost);
    const courierCode = stringValue(item.code);
    const serviceCode = stringValue(item.service);
    if (cost === null || !courierCode || !serviceCode) return [];
    return [{
      courierCode,
      courierName: stringValue(item.name) || courierCode.toUpperCase(),
      serviceCode,
      serviceDescription: stringValue(item.description),
      cost,
      etd: stringValue(item.etd) || null
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNumber(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
