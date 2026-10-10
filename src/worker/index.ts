import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  checkoutSchema,
  destinationSearchSchema,
  inventoryAdjustmentSchema,
  orderStatusUpdateSchema,
  productInputSchema,
  publicOrderLookupSchema,
  pushSubscriptionSchema,
  shippingQuoteRequestSchema
} from "../shared/schemas";
import { requireAdmin } from "./lib/auth";
import {
  addProductImage,
  adjustInventory,
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  removeProductImage,
  updateProduct
} from "./lib/catalog";
import { ApiError, type AppBindings, nowIso, parseJson, success } from "./lib/core";
import {
  applyPaymentCallback,
  createOrder,
  dashboardSummary,
  expirePendingOrders,
  getPublicOrder,
  listAdminOrders,
  savePushSubscription,
  simulateLocalPayment,
  updateOrderStatus
} from "./lib/orders";
import { processNotification, retryNotification, type NotificationQueueMessage } from "./lib/notifications";
import { verifyTurnstile } from "./lib/turnstile";
import { parseAndVerifyKomerceCallback } from "./providers/payment";
import { createShippingQuotes, searchDestinations } from "./providers/shipping";

const app = new Hono<AppBindings>();

app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  const requestId = c.req.header("Cf-Ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  console.log(JSON.stringify({ message: "request", method: c.req.method, path: c.req.path, requestId }));
  await next();
});

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1 AS healthy").first();
  return success(c, { status: "ok", environment: c.env.ENVIRONMENT, time: nowIso() });
});

app.get("/api/config", (c) => success(c, {
  turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
  vapidPublicKey: c.env.VAPID_PUBLIC_KEY,
  pushEnabled: Boolean(c.env.VAPID_PUBLIC_KEY)
}));

app.get("/api/products", async (c) => success(c, await listProducts(c.env.DB, true)));
app.get("/api/products/:slug", async (c) => success(c, await getProduct(c.env.DB, c.req.param("slug"), true)));

app.get("/api/shipping/destinations", async (c) => {
  const parsed = destinationSearchSchema.safeParse({ q: c.req.query("q") ?? "" });
  if (!parsed.success) throw new ApiError(422, "search_query_invalid", "Enter at least two characters");
  return success(c, await searchDestinations(c.env, parsed.data.q));
});
app.post("/api/shipping/quotes", async (c) => {
  const input = await parseJson(c.req.raw, shippingQuoteRequestSchema);
  return success(c, await createShippingQuotes(c.env, input), 201);
});

app.post("/api/orders", async (c) => {
  const input = await parseJson(c.req.raw, checkoutSchema);
  await verifyTurnstile(c.env, input.turnstileToken, c.req.header("CF-Connecting-IP"));
  return success(c, await createOrder(c.env, input), 201);
});
app.post("/api/orders/:orderNumber/lookup", async (c) => {
  const input = await parseJson(c.req.raw, publicOrderLookupSchema);
  return success(c, await getPublicOrder(c.env.DB, c.req.param("orderNumber"), input.token));
});
app.post("/api/orders/:orderNumber/push-subscriptions", async (c) => {
  const input = await parseJson(c.req.raw, pushSubscriptionSchema);
  await savePushSubscription(c.env.DB, c.req.param("orderNumber"), input.token, input);
  return success(c, { subscribed: true }, 201);
});

app.post("/api/payments/komerce/callback", async (c) => {
  const rawBody = await c.req.raw.text();
  const event = await parseAndVerifyKomerceCallback(
    rawBody,
    c.req.header("X-Callback-Api-Key") ?? "",
    c.env.KOMERCE_CALLBACK_SECRET
  );
  await applyPaymentCallback(c.env, event);
  return success(c, { accepted: true });
});

app.get("/media/*", async (c) => {
  const objectKey = decodeURIComponent(c.req.path.slice("/media/".length));
  if (!objectKey || objectKey.includes("..")) throw new ApiError(404, "media_not_found", "Media was not found");
  const object = await c.env.PRODUCT_MEDIA.get(objectKey);
  if (!object?.body) throw new ApiError(404, "media_not_found", "Media was not found");
  const headers = new Headers({
    ETag: object.httpEtag,
    "Cache-Control": "public, max-age=31536000, immutable"
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

app.use("/api/admin/*", requireAdmin);
app.get("/api/admin/me", (c) => success(c, { email: c.get("adminEmail") }));
app.get("/api/admin/dashboard", async (c) => success(c, await dashboardSummary(c.env.DB)));
app.get("/api/admin/products", async (c) => success(c, await listProducts(c.env.DB, false)));
app.post("/api/admin/products", async (c) => {
  const input = await parseJson(c.req.raw, productInputSchema);
  const id = await createProduct(c.env.DB, input, c.get("adminEmail"));
  return success(c, await getProduct(c.env.DB, id), 201);
});
app.put("/api/admin/products/:id", async (c) => {
  const input = await parseJson(c.req.raw, productInputSchema);
  await updateProduct(c.env.DB, c.req.param("id"), input, c.get("adminEmail"));
  return success(c, await getProduct(c.env.DB, c.req.param("id")));
});
app.delete("/api/admin/products/:id", async (c) => {
  await archiveProduct(c.env.DB, c.req.param("id"), c.get("adminEmail"));
  return success(c, { archived: true });
});
app.post("/api/admin/variants/:id/inventory", async (c) => {
  const input = await parseJson(c.req.raw, inventoryAdjustmentSchema);
  await adjustInventory(c.env.DB, c.req.param("id"), input.stockOnHand, input.note, c.get("adminEmail"));
  return success(c, { updated: true });
});
app.post("/api/admin/products/:id/images", async (c) => {
  const contentLength = Number.parseInt(c.req.header("Content-Length") ?? "0", 10);
  if (contentLength > 6 * 1024 * 1024) throw new ApiError(422, "image_too_large", "Image must be at most 5 MiB");
  const form = await c.req.formData();
  const file = form.get("file");
  const altEntry = form.get("altText");
  const sortEntry = form.get("sortOrder");
  const altText = typeof altEntry === "string" ? altEntry.trim() : "";
  const sortOrder = Number.parseInt(typeof sortEntry === "string" ? sortEntry : "0", 10);
  if (!(file instanceof File)) throw new ApiError(422, "image_required", "Choose an image to upload");
  if (file.size > 5 * 1024 * 1024) throw new ApiError(422, "image_too_large", "Image must be at most 5 MiB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new ApiError(422, "image_type_invalid", "Image must be JPEG, PNG, or WebP");
  }
  if (!altText || altText.length > 300) throw new ApiError(422, "alt_text_invalid", "Image alt text is required");
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `products/${c.req.param("id")}/${crypto.randomUUID()}.${extension}`;
  await c.env.PRODUCT_MEDIA.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }
  });
  try {
    const imageId = await addProductImage(
      c.env.DB, c.req.param("id"), objectKey, altText,
      Number.isSafeInteger(sortOrder) ? sortOrder : 0, c.get("adminEmail")
    );
    return success(c, { id: imageId, url: `/media/${objectKey}` }, 201);
  } catch (error) {
    await c.env.PRODUCT_MEDIA.delete(objectKey);
    throw error;
  }
});
app.delete("/api/admin/products/:productId/images/:imageId", async (c) => {
  const key = await removeProductImage(
    c.env.DB, c.req.param("productId"), c.req.param("imageId"), c.get("adminEmail")
  );
  await c.env.PRODUCT_MEDIA.delete(key);
  return success(c, { removed: true });
});

app.get("/api/admin/orders", async (c) => success(c, await listAdminOrders(c.env.DB)));
app.patch("/api/admin/orders/:id/status", async (c) => {
  const input = await parseJson(c.req.raw, orderStatusUpdateSchema);
  await updateOrderStatus(c.env, c.req.param("id"), input, c.get("adminEmail"));
  return success(c, { updated: true });
});
app.post("/api/admin/orders/:id/mock-payment", async (c) => {
  await simulateLocalPayment(c.env, c.req.param("id"));
  return success(c, { paid: true });
});
app.get("/api/admin/notifications", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT n.id, n.order_id, o.order_number, n.event_type, n.channel, n.status,
            n.attempts, n.last_error, n.created_at, n.updated_at
     FROM notification_deliveries n JOIN orders o ON o.id = n.order_id
     ORDER BY n.created_at DESC LIMIT 200`
  ).all();
  return success(c, result.results);
});
app.post("/api/admin/notifications/:id/retry", async (c) => {
  await retryNotification(c.env, c.req.param("id"));
  await c.env.DB.prepare(
    `INSERT INTO admin_audit_log
     (id, admin_email, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, 'notification.retry', 'notification', ?, 'Manual retry', ?)`
  ).bind(crypto.randomUUID(), c.get("adminEmail"), c.req.param("id"), nowIso()).run();
  return success(c, { queued: true }, 202);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({
      error: { code: "not_found", message: "Resource was not found" },
      requestId: c.get("requestId")
    }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({
      error: { code: error.code, message: error.message, details: error.details },
      requestId: c.get("requestId")
    }, error.status);
  }
  console.error(JSON.stringify({
    message: "unhandled_error",
    requestId: c.get("requestId"),
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error)
  }));
  return c.json({
    error: { code: "internal_error", message: "An unexpected error occurred" },
    requestId: c.get("requestId")
  }, 500);
});

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processNotification(env, message.body);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          message: "notification_failed",
          queueMessageId: message.id,
          error: error instanceof Error ? error.message : String(error)
        }));
        message.retry();
      }
    }
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(expirePendingOrders(env).then((count) => {
      console.log(JSON.stringify({ message: "orders_expired", count }));
    }));
  }
} satisfies ExportedHandler<Env, NotificationQueueMessage>;
