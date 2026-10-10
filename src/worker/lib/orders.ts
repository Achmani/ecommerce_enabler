import type { CheckoutInput, OrderStatusUpdate } from "../../shared/schemas";
import type { OrderSummary, PaymentView } from "../../shared/types";
import { timingSafeEqual } from "node:crypto";
import { resolveCart } from "./cart";
import { addSeconds, ApiError, nowIso, sha256 } from "./core";
import { createPayment, type CallbackEvent } from "../providers/payment";
import { queueOrderNotifications, type NotificationEventType } from "./notifications";

type QuoteRow = {
  id: string;
  destination_id: string;
  destination_label: string;
  courier_code: string;
  courier_name: string;
  service_code: string;
  cost: number;
  etd: string | null;
  cart_fingerprint: string;
  expires_at: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  public_token_hash: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_email: string;
  subtotal: number;
  shipping_cost: number;
  grand_total: number;
  courier_name: string;
  shipping_service: string;
  airway_bill: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  order_id: string;
  provider: string;
  provider_payment_id: string;
  status: PaymentView["status"];
  checkout_url: string | null;
  qr_string: string | null;
  expires_at: string;
};

type OrderItemRow = {
  variant_id: string;
  quantity: number;
};

export type CreatedOrder = {
  order: OrderSummary;
  accessToken: string;
};

export async function createOrder(env: Env, input: CheckoutInput): Promise<CreatedOrder> {
  const existing = await env.DB.prepare(
    "SELECT order_number FROM orders WHERE idempotency_key = ?"
  ).bind(input.idempotencyKey).first<{ order_number: string }>();
  const accessToken = await deriveOrderToken(env.ORDER_TOKEN_SECRET, input.idempotencyKey);
  if (existing) {
    return { order: await getPublicOrder(env.DB, existing.order_number, accessToken), accessToken };
  }

  const cart = await resolveCart(env.DB, input.items);
  const quote = await env.DB.prepare(
    `SELECT id, destination_id, destination_label, courier_code, courier_name, service_code,
            cost, etd, cart_fingerprint, expires_at
     FROM shipping_quotes WHERE id = ?`
  ).bind(input.shippingQuoteId).first<QuoteRow>();
  if (!quote) throw new ApiError(422, "shipping_quote_not_found", "Shipping quote was not found");
  if (new Date(quote.expires_at).getTime() <= Date.now()) {
    throw new ApiError(409, "shipping_quote_expired", "Shipping quote has expired");
  }
  if (quote.destination_id !== input.address.destinationId || quote.cart_fingerprint !== cart.fingerprint) {
    throw new ApiError(409, "shipping_quote_mismatch", "Shipping quote no longer matches the checkout");
  }

  const orderId = crypto.randomUUID();
  const orderNumber = makeOrderNumber();
  const tokenHash = await sha256(accessToken);
  const timestamp = nowIso();
  const initialExpiry = addSeconds(new Date(), 3600);
  const grandTotal = cart.subtotal + quote.cost;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO orders
       (id, order_number, public_token_hash, idempotency_key, status, payment_status,
        customer_name, customer_email, customer_phone, destination_id, destination_label,
        address_line, postal_code, customer_note, subtotal, shipping_cost, adjustment_total,
        grand_total, shipping_quote_id, courier_code, courier_name, shipping_service, shipping_etd,
        payment_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending_payment', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, orderNumber, tokenHash, input.idempotencyKey,
      input.customer.name, input.customer.email, input.customer.phone,
      input.address.destinationId, input.address.destinationLabel, input.address.addressLine,
      input.address.postalCode, input.customerNote, cart.subtotal, quote.cost, grandTotal,
      quote.id, quote.courier_code, quote.courier_name, quote.service_code, quote.etd,
      initialExpiry, timestamp, timestamp
    )
  ];

  for (const item of cart.items) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO order_items
         (id, order_id, product_id, variant_id, product_name, variant_name, sku,
          unit_price, quantity, weight_grams, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), orderId, item.productId, item.variantId, item.productName,
        item.variantName, item.sku, item.unitPrice, item.quantity, item.weightGrams,
        item.unitPrice * item.quantity
      ),
      env.DB.prepare(
        `UPDATE product_variants
         SET reserved_quantity = reserved_quantity + ?, updated_at = ? WHERE id = ?`
      ).bind(item.quantity, timestamp, item.variantId),
      env.DB.prepare(
        `INSERT INTO inventory_movements
         (id, variant_id, order_id, movement_type, quantity, note, actor, created_at)
         VALUES (?, ?, ?, 'reservation', ?, 'Checkout reservation', 'system', ?)`
      ).bind(crypto.randomUUID(), item.variantId, orderId, -item.quantity, timestamp)
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO order_events
       (id, order_id, previous_status, new_status, note, actor, created_at)
       VALUES (?, ?, NULL, 'pending_payment', 'Order created', 'customer', ?)`
    ).bind(crypto.randomUUID(), orderId, timestamp)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("orders.idempotency_key")) {
      const duplicate = await env.DB.prepare(
        "SELECT order_number FROM orders WHERE idempotency_key = ?"
      ).bind(input.idempotencyKey).first<{ order_number: string }>();
      if (duplicate) return { order: await getPublicOrder(env.DB, duplicate.order_number, accessToken), accessToken };
    }
    if (message.includes("CHECK constraint failed")) {
      throw new ApiError(409, "insufficient_stock", "Stock changed while the order was being created");
    }
    if (message.includes("orders.shipping_quote_id")) {
      throw new ApiError(409, "shipping_quote_consumed", "This shipping quote has already been used");
    }
    throw error;
  }

  try {
    const payment = await createPayment(
      env, orderId, orderNumber, grandTotal, quote.cost, cart, input.customer
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments
         (id, order_id, provider, provider_payment_id, status, payment_reference,
          checkout_url, qr_string, provider_response, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), orderId, payment.provider, payment.providerPaymentId,
        payment.paymentReference, payment.checkoutUrl, payment.qrString,
        payment.expiresAt, timestamp, timestamp
      ),
      env.DB.prepare(
        "UPDATE orders SET payment_expires_at = ?, updated_at = ? WHERE id = ?"
      ).bind(payment.expiresAt, nowIso(), orderId)
    ]);
  } catch (error) {
    await releasePendingOrder(env.DB, orderId, "Payment creation failed", "system", "failed");
    throw error;
  }

  return { order: await getPublicOrder(env.DB, orderNumber, accessToken), accessToken };
}

export async function getPublicOrder(db: D1Database, orderNumber: string, token: string): Promise<OrderSummary> {
  const order = await db.prepare(
    `SELECT id, order_number, public_token_hash, status, payment_status, customer_name, customer_email,
            subtotal, shipping_cost, grand_total, courier_name, shipping_service, airway_bill, created_at
     FROM orders WHERE order_number = ?`
  ).bind(orderNumber).first<OrderRow>();
  if (!order || !(await hashesEqual(order.public_token_hash, await sha256(token)))) {
    throw new ApiError(404, "order_not_found", "Order was not found");
  }
  return orderSummary(db, order);
}

export async function listAdminOrders(
  db: D1Database,
  limit = 100
): Promise<Array<OrderSummary & { id: string }>> {
  const result = await db.prepare(
    `SELECT id, order_number, public_token_hash, status, payment_status, customer_name, customer_email,
            subtotal, shipping_cost, grand_total, courier_name, shipping_service, airway_bill, created_at
     FROM orders ORDER BY created_at DESC LIMIT ?`
  ).bind(Math.min(Math.max(limit, 1), 200)).all<OrderRow>();
  return Promise.all(result.results.map(async (order) => ({
    ...(await orderSummary(db, order)),
    id: order.id
  })));
}

export async function dashboardSummary(db: D1Database) {
  const [orders, sales, fulfillment, stock] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM orders").first<{ count: number }>(),
    db.prepare("SELECT COALESCE(SUM(grand_total), 0) AS total FROM orders WHERE payment_status = 'paid'")
      .first<{ total: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status IN ('paid', 'processing')")
      .first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM product_variants
       WHERE is_active = 1 AND (stock_on_hand - reserved_quantity) <= low_stock_threshold`
    ).first<{ count: number }>()
  ]);
  return {
    totalOrders: orders?.count ?? 0,
    paidSales: sales?.total ?? 0,
    pendingFulfillment: fulfillment?.count ?? 0,
    lowStockVariants: stock?.count ?? 0
  };
}

export async function updateOrderStatus(
  env: Env,
  orderId: string,
  input: OrderStatusUpdate,
  adminEmail: string
): Promise<void> {
  const order = await env.DB.prepare(
    "SELECT id, status, payment_status FROM orders WHERE id = ?"
  ).bind(orderId).first<{ id: string; status: string; payment_status: string }>();
  if (!order) throw new ApiError(404, "order_not_found", "Order was not found");
  const allowed: Record<string, string[]> = {
    paid: ["processing"],
    processing: ["shipped"],
    shipped: ["delivered"],
    pending_payment: ["cancelled"]
  };
  if (!(allowed[order.status] ?? []).includes(input.status)) {
    throw new ApiError(409, "order_transition_invalid", `Cannot change ${order.status} to ${input.status}`);
  }
  if (input.status === "cancelled") {
    await releasePendingOrder(env.DB, orderId, input.note || "Cancelled by administrator", adminEmail, "cancelled");
    await queueOrderNotifications(env, orderId, "cancelled");
    return;
  }

  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE orders SET status = ?, courier_name = COALESCE(?, courier_name),
       airway_bill = COALESCE(?, airway_bill), updated_at = ? WHERE id = ?`
    ).bind(input.status, input.courierName ?? null, input.airwayBill ?? null, timestamp, orderId),
    env.DB.prepare(
      `INSERT INTO order_events
       (id, order_id, previous_status, new_status, note, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), orderId, order.status, input.status, input.note, adminEmail, timestamp),
    env.DB.prepare(
      `INSERT INTO admin_audit_log
       (id, admin_email, action, entity_type, entity_id, summary, created_at)
       VALUES (?, ?, 'order.status.update', 'order', ?, ?, ?)`
    ).bind(crypto.randomUUID(), adminEmail, orderId, `${order.status} -> ${input.status}`, timestamp)
  ]);
  await queueOrderNotifications(env, orderId, statusToNotification(input.status));
}

export async function applyPaymentCallback(env: Env, event: CallbackEvent): Promise<void> {
  const payment = await env.DB.prepare(
    `SELECT id, order_id, provider, provider_payment_id, status, checkout_url, qr_string, expires_at
     FROM payments WHERE provider_payment_id = ?`
  ).bind(event.providerPaymentId).first<PaymentRow>();
  if (!payment) throw new ApiError(404, "payment_not_found", "Payment was not found");

  if (event.status === "paid") {
    if (payment.status !== "paid") await commitPaidOrder(env.DB, payment, event.deduplicationKey);
    await queueOrderNotifications(env, payment.order_id, "payment_received");
    return;
  }
  if (event.status === "expired" || event.status === "cancelled" || event.status === "failed") {
    if (payment.status === "paid") return;
    await releasePendingOrder(env.DB, payment.order_id, `Payment ${event.status}`, "payment-provider", event.status);
    await queueOrderNotifications(env, payment.order_id, event.status === "expired" ? "payment_expired" : "cancelled");
  }
}

export async function simulateLocalPayment(env: Env, orderId: string): Promise<void> {
  if (env.ENVIRONMENT === "production") throw new ApiError(404, "not_found", "Resource was not found");
  const payment = await env.DB.prepare(
    `SELECT id, order_id, provider, provider_payment_id, status, checkout_url, qr_string, expires_at
     FROM payments WHERE order_id = ?`
  ).bind(orderId).first<PaymentRow>();
  if (!payment) throw new ApiError(404, "payment_not_found", "Payment was not found");
  await applyPaymentCallback(env, {
    providerPaymentId: payment.provider_payment_id,
    providerOrderId: null,
    status: "paid",
    deduplicationKey: `local-paid:${payment.provider_payment_id}`
  });
}

export async function expirePendingOrders(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT id FROM orders
     WHERE status = 'pending_payment' AND payment_expires_at <= ?
     ORDER BY payment_expires_at LIMIT 100`
  ).bind(nowIso()).all<{ id: string }>();
  for (const order of result.results) {
    await releasePendingOrder(env.DB, order.id, "Payment window expired", "scheduler", "expired");
    await queueOrderNotifications(env, order.id, "payment_expired");
  }
  return result.results.length;
}

export async function savePushSubscription(
  db: D1Database,
  orderNumber: string,
  token: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
  const order = await db.prepare(
    "SELECT id, public_token_hash FROM orders WHERE order_number = ?"
  ).bind(orderNumber).first<{ id: string; public_token_hash: string }>();
  if (!order || !(await hashesEqual(order.public_token_hash, await sha256(token)))) {
    throw new ApiError(404, "order_not_found", "Order was not found");
  }
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO push_subscriptions
     (id, order_id, endpoint, p256dh, auth, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       order_id = excluded.order_id, p256dh = excluded.p256dh, auth = excluded.auth,
       is_active = 1, updated_at = excluded.updated_at`
  ).bind(
    crypto.randomUUID(), order.id, subscription.endpoint, subscription.keys.p256dh,
    subscription.keys.auth, timestamp, timestamp
  ).run();
}

async function commitPaidOrder(db: D1Database, payment: PaymentRow, deduplicationKey: string): Promise<void> {
  const items = await db.prepare(
    "SELECT variant_id, quantity FROM order_items WHERE order_id = ?"
  ).bind(payment.order_id).all<OrderItemRow>();
  const order = await db.prepare("SELECT status FROM orders WHERE id = ?")
    .bind(payment.order_id).first<{ status: string }>();
  if (!order || order.status !== "pending_payment") return;
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO payment_events
       (id, provider, deduplication_key, payment_id, event_type, received_at)
       VALUES (?, ?, ?, ?, 'paid', ?)`
    ).bind(crypto.randomUUID(), payment.provider, deduplicationKey, payment.id, timestamp),
    db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?")
      .bind(timestamp, timestamp, payment.id),
    db.prepare("UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ?")
      .bind(timestamp, payment.order_id),
    db.prepare(
      `INSERT INTO order_events
       (id, order_id, previous_status, new_status, note, actor, created_at)
       VALUES (?, ?, 'pending_payment', 'paid', 'Payment confirmed', 'payment-provider', ?)`
    ).bind(crypto.randomUUID(), payment.order_id, timestamp)
  ];
  for (const item of items.results) {
    statements.push(
      db.prepare(
        `UPDATE product_variants SET stock_on_hand = stock_on_hand - ?,
         reserved_quantity = reserved_quantity - ?, updated_at = ? WHERE id = ?`
      ).bind(item.quantity, item.quantity, timestamp, item.variant_id),
      db.prepare(
        `INSERT INTO inventory_movements
         (id, variant_id, order_id, movement_type, quantity, note, actor, created_at)
         VALUES (?, ?, ?, 'sale', ?, 'Payment confirmed', 'payment-provider', ?)`
      ).bind(crypto.randomUUID(), item.variant_id, payment.order_id, -item.quantity, timestamp)
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("payment_events.provider")) return;
    throw error;
  }
}

async function releasePendingOrder(
  db: D1Database,
  orderId: string,
  note: string,
  actor: string,
  paymentStatus: "expired" | "failed" | "cancelled"
): Promise<void> {
  const order = await db.prepare("SELECT status FROM orders WHERE id = ?")
    .bind(orderId).first<{ status: string }>();
  if (!order || order.status !== "pending_payment") return;
  const items = await db.prepare("SELECT variant_id, quantity FROM order_items WHERE order_id = ?")
    .bind(orderId).all<OrderItemRow>();
  const timestamp = nowIso();
  const nextOrderStatus = paymentStatus === "expired" ? "expired" : "cancelled";
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?")
      .bind(nextOrderStatus, paymentStatus, timestamp, orderId),
    db.prepare("UPDATE payments SET status = ?, updated_at = ? WHERE order_id = ? AND status = 'pending'")
      .bind(paymentStatus, timestamp, orderId),
    db.prepare(
      `INSERT INTO order_events
       (id, order_id, previous_status, new_status, note, actor, created_at)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), orderId, nextOrderStatus, note, actor, timestamp)
  ];
  for (const item of items.results) {
    statements.push(
      db.prepare(
        `UPDATE product_variants SET reserved_quantity = reserved_quantity - ?, updated_at = ?
         WHERE id = ?`
      ).bind(item.quantity, timestamp, item.variant_id),
      db.prepare(
        `INSERT INTO inventory_movements
         (id, variant_id, order_id, movement_type, quantity, note, actor, created_at)
         VALUES (?, ?, ?, 'release', ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), item.variant_id, orderId, item.quantity, note, actor, timestamp)
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("order_events.order_id, order_events.new_status")) return;
    throw error;
  }
}

async function orderSummary(db: D1Database, order: OrderRow): Promise<OrderSummary> {
  const payment = await db.prepare(
    `SELECT status, provider, checkout_url, qr_string, expires_at FROM payments WHERE order_id = ?`
  ).bind(order.id).first<{
    status: PaymentView["status"];
    provider: string;
    checkout_url: string | null;
    qr_string: string | null;
    expires_at: string;
  }>();
  return {
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    subtotal: order.subtotal,
    shippingCost: order.shipping_cost,
    grandTotal: order.grand_total,
    courierName: order.courier_name,
    shippingService: order.shipping_service,
    airwayBill: order.airway_bill,
    createdAt: order.created_at,
    payment: payment ? {
      status: payment.status,
      provider: payment.provider,
      checkoutUrl: payment.checkout_url,
      qrString: payment.qr_string,
      expiresAt: payment.expires_at
    } : null
  };
}

function statusToNotification(status: OrderStatusUpdate["status"]): NotificationEventType {
  if (status === "paid") return "payment_received";
  return status;
}

function makeOrderNumber(): string {
  const date = new Date();
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `TM-${ymd}-${suffix}`;
}

async function deriveOrderToken(secret: string, idempotencyKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`order:${idempotencyKey}`))
  );
  return bytesToBase64Url(signature);
}

async function hashesEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right))
  ]);
  return timingSafeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
