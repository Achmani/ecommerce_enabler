import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { ApiError, nowIso } from "./core";

export type NotificationEventType =
  | "payment_received"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "payment_expired";

export type NotificationQueueMessage = { deliveryId: string };

type DeliveryRow = {
  id: string;
  order_id: string;
  event_type: NotificationEventType;
  channel: "email" | "push";
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
};

type OrderNotificationRow = {
  order_number: string;
  public_token_hash: string;
  customer_name: string;
  customer_email: string;
  status: string;
  grand_total: number;
  courier_name: string;
  shipping_service: string;
  airway_bill: string | null;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function queueOrderNotifications(
  env: Env,
  orderId: string,
  eventType: NotificationEventType
): Promise<void> {
  const timestamp = nowIso();
  for (const channel of ["email", "push"] as const) {
    const deduplicationKey = `${eventType}:${orderId}:${channel}`;
    const deliveryId = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_deliveries
       (id, order_id, event_type, channel, deduplication_key, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`
    ).bind(deliveryId, orderId, eventType, channel, deduplicationKey, timestamp, timestamp).run();
    let queuedId: string = deliveryId;
    if ((result.meta.changes ?? 0) === 0) {
      const existing = await env.DB.prepare(
        "SELECT id, status FROM notification_deliveries WHERE deduplication_key = ?"
      ).bind(deduplicationKey).first<{ id: string; status: string }>();
      if (!existing || !["queued", "failed"].includes(existing.status)) continue;
      queuedId = existing.id;
    }
    await env.NOTIFICATION_QUEUE.send({ deliveryId: queuedId } satisfies NotificationQueueMessage);
  }
}

export async function processNotification(env: Env, message: NotificationQueueMessage): Promise<void> {
  const timestamp = nowIso();
  const claim = await env.DB.prepare(
    `UPDATE notification_deliveries
     SET status = 'sending', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'failed')`
  ).bind(timestamp, message.deliveryId).run();
  if ((claim.meta.changes ?? 0) === 0) return;

  const delivery = await env.DB.prepare(
    `SELECT id, order_id, event_type, channel, status, attempts
     FROM notification_deliveries WHERE id = ?`
  ).bind(message.deliveryId).first<DeliveryRow>();
  if (!delivery) return;
  const order = await env.DB.prepare(
    `SELECT order_number, public_token_hash, customer_name, customer_email, status, grand_total,
            courier_name, shipping_service, airway_bill
     FROM orders WHERE id = ?`
  ).bind(delivery.order_id).first<OrderNotificationRow>();
  if (!order) {
    await markFailed(env.DB, delivery.id, "Order no longer exists");
    return;
  }

  try {
    let providerId: string | null = null;
    if (env.ENVIRONMENT !== "production") {
      providerId = `local-sink:${delivery.id}`;
    } else if (delivery.channel === "email") {
      providerId = await sendEmail(env, delivery, order);
    } else {
      providerId = await sendPush(env, delivery, order);
    }
    await env.DB.prepare(
      `UPDATE notification_deliveries
       SET status = 'sent', provider_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`
    ).bind(providerId, nowIso(), delivery.id).run();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown provider error";
    await markFailed(env.DB, delivery.id, messageText.slice(0, 500));
    throw error;
  }
}

export async function retryNotification(env: Env, deliveryId: string): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE notification_deliveries SET status = 'queued', updated_at = ?
     WHERE id = ? AND status = 'failed'`
  ).bind(nowIso(), deliveryId).run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new ApiError(409, "notification_not_retryable", "Only failed notifications can be retried");
  }
  await env.NOTIFICATION_QUEUE.send({ deliveryId } satisfies NotificationQueueMessage);
}

async function sendEmail(env: Env, delivery: DeliveryRow, order: OrderNotificationRow): Promise<string> {
  const content = notificationContent(delivery.event_type, order);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": delivery.id
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [order.customer_email],
      subject: content.title,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h1>${escapeHtml(content.title)}</h1>
        <p>Halo ${escapeHtml(order.customer_name)},</p>
        <p>${escapeHtml(content.body)}</p>
        <p><strong>Pesanan:</strong> ${escapeHtml(order.order_number)}</p>
        ${order.airway_bill ? `<p><strong>Resi:</strong> ${escapeHtml(order.airway_bill)}</p>` : ""}
        <p>Terima kasih sudah menjadikan Teman Makan bagian dari meja makanmu.</p>
      </div>`
    })
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new Error(`Email provider returned ${status}`);
  }
  const payload: unknown = await response.json();
  return isRecord(payload) && typeof payload.id === "string" ? payload.id : delivery.id;
}

async function sendPush(env: Env, delivery: DeliveryRow, order: OrderNotificationRow): Promise<string> {
  const subscriptions = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE order_id = ? AND is_active = 1`
  ).bind(delivery.order_id).all<SubscriptionRow>();
  if (subscriptions.results.length === 0) return `no-subscribers:${delivery.id}`;

  const content = notificationContent(delivery.event_type, order);
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  for (const row of subscriptions.results) {
    const subscription: PushSubscription = {
      endpoint: row.endpoint,
      expirationTime: null,
      keys: { p256dh: row.p256dh, auth: row.auth }
    };
    const payload = await buildPushPayload({
      data: JSON.stringify({
        title: content.title,
        body: content.body,
        url: `/order/${encodeURIComponent(order.order_number)}`
      }),
      options: { ttl: 3600 }
    }, subscription, vapid);
    const response = await fetch(subscription.endpoint, payload);
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      await env.DB.prepare(
        "UPDATE push_subscriptions SET is_active = 0, updated_at = ? WHERE id = ?"
      ).bind(nowIso(), row.id).run();
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      throw new Error(`Push provider returned ${status}`);
    }
    await response.body?.cancel();
  }
  return `web-push:${delivery.id}`;
}

function notificationContent(eventType: NotificationEventType, order: OrderNotificationRow) {
  const messages: Record<NotificationEventType, { title: string; body: string }> = {
    payment_received: {
      title: `Pembayaran ${order.order_number} diterima`,
      body: "Pembayaranmu sudah kami terima dan pesanan akan segera disiapkan."
    },
    processing: {
      title: `Pesanan ${order.order_number} sedang disiapkan`,
      body: "Teman Makanmu sedang kami siapkan dengan baik."
    },
    shipped: {
      title: `Pesanan ${order.order_number} sudah dikirim`,
      body: `Pesanan dikirim melalui ${order.courier_name} ${order.shipping_service}.`
    },
    delivered: {
      title: `Pesanan ${order.order_number} telah diterima`,
      body: "Semoga Teman Makan membuat setiap suapan lebih seru."
    },
    cancelled: {
      title: `Pesanan ${order.order_number} dibatalkan`,
      body: "Pesanan telah dibatalkan. Hubungi kami jika kamu membutuhkan bantuan."
    },
    payment_expired: {
      title: `Pembayaran ${order.order_number} kedaluwarsa`,
      body: "Waktu pembayaran telah berakhir dan stok yang dipesan sudah dilepaskan."
    }
  };
  return messages[eventType];
}

async function markFailed(db: D1Database, id: string, message: string): Promise<void> {
  await db.prepare(
    `UPDATE notification_deliveries SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`
  ).bind(message, nowIso(), id).run();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] ?? character);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
