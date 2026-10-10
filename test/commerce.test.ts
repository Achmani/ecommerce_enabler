import { env, exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type ApiResponse<T> = { data: T; requestId: string };

async function api<T>(path: string, init?: RequestInit): Promise<{ response: Response; body: ApiResponse<T> }> {
  const response = await workerExports.default.fetch(new Request(`https://example.test${path}`, init));
  const body = await response.json<ApiResponse<T>>();
  return { response, body };
}

describe("commerce Worker", () => {
  it("reports a healthy D1-backed API", async () => {
    const { response, body } = await api<{ status: string; environment: string }>("/api/health");

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status: "ok", environment: "test" });
    expect(body.requestId).toBeTruthy();
  });

  it("runs product, shipping, checkout, payment, and inventory lifecycle", async () => {
    const create = await api<{
      id: string;
      slug: string;
      variants: Array<{ id: string; stockOnHand: number; reservedQuantity: number }>;
    }>("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "sambal-teman-makan",
        name: "Sambal Teman Makan",
        description: "Produk uji integrasi",
        status: "active",
        variants: [{
          sku: "TM-SAMBAL-001",
          name: "Botol 150 ml",
          price: 45000,
          weightGrams: 350,
          stockOnHand: 10,
          lowStockThreshold: 2,
          isActive: true
        }]
      })
    });
    expect(create.response.status).toBe(201);
    const product = create.body.data;
    const variant = product.variants[0];
    expect(variant.stockOnHand).toBe(10);

    const initialMovement = await env.DB.prepare(
      "SELECT quantity, note FROM inventory_movements WHERE variant_id = ?"
    ).bind(variant.id).first<{ quantity: number; note: string }>();
    expect(initialMovement).toMatchObject({ quantity: 10, note: "Initial stock" });

    const catalogue = await api<Array<{ slug: string }>>("/api/products");
    expect(catalogue.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "sambal-teman-makan" })
    ]));

    const destinations = await api<Array<{ id: string }>>("/api/shipping/destinations?q=Jakarta");
    expect(destinations.body.data[0]?.id).toMatch(/^mock-/);

    const quoteResult = await api<Array<{ id: string; cost: number }>>("/api/shipping/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationId: "mock-jakarta-10110",
        destinationLabel: "Jakarta Pusat",
        items: [{ variantId: variant.id, quantity: 2 }]
      })
    });
    expect(quoteResult.response.status).toBe(201);
    const quote = quoteResult.body.data[0];
    expect(quote.cost).toBeGreaterThan(0);

    const orderPayload = {
      shippingQuoteId: quote.id,
      idempotencyKey: crypto.randomUUID(),
      turnstileToken: "",
      customer: {
        name: "Pelanggan Uji",
        email: "customer@example.com",
        phone: "081234567890"
      },
      address: {
        destinationId: "mock-jakarta-10110",
        destinationLabel: "Jakarta Pusat",
        addressLine: "Jl. Pengujian No. 1",
        postalCode: "10110"
      },
      customerNote: "",
      items: [{ variantId: variant.id, quantity: 2 }]
    };
    const orderResult = await api<{
      order: { orderNumber: string; status: string; paymentStatus: string };
      accessToken: string;
    }>("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });
    expect(orderResult.response.status).toBe(201);
    expect(orderResult.body.data.order).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });

    const repeatedOrder = await api<{ order: { orderNumber: string } }>("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });
    expect(repeatedOrder.body.data.order.orderNumber).toBe(orderResult.body.data.order.orderNumber);

    const reserved = await env.DB.prepare(
      "SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?"
    ).bind(variant.id).first<{ stock_on_hand: number; reserved_quantity: number }>();
    expect(reserved).toEqual({ stock_on_hand: 10, reserved_quantity: 2 });

    const orders = await api<Array<{ id: string; orderNumber: string }>>("/api/admin/orders");
    const adminOrder = orders.body.data.find(
      (candidate) => candidate.orderNumber === orderResult.body.data.order.orderNumber
    );
    expect(adminOrder).toBeTruthy();

    const payment = await api<{ paid: boolean }>(`/api/admin/orders/${adminOrder!.id}/mock-payment`, {
      method: "POST"
    });
    expect(payment.response.status).toBe(200);

    const paidLookup = await api<{ status: string; paymentStatus: string }>(
      `/api/orders/${orderResult.body.data.order.orderNumber}/lookup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: orderResult.body.data.accessToken })
      }
    );
    expect(paidLookup.body.data).toMatchObject({ status: "paid", paymentStatus: "paid" });

    const sold = await env.DB.prepare(
      "SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?"
    ).bind(variant.id).first<{ stock_on_hand: number; reserved_quantity: number }>();
    expect(sold).toEqual({ stock_on_hand: 8, reserved_quantity: 0 });

    const saleMovement = await env.DB.prepare(
      "SELECT quantity FROM inventory_movements WHERE variant_id = ? AND movement_type = 'sale'"
    ).bind(variant.id).first<{ quantity: number }>();
    expect(saleMovement?.quantity).toBe(-2);
  });
});
