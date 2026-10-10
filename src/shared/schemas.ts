import { z } from "zod";

const id = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

export const cartLineSchema = z.object({
  variantId: id,
  quantity: z.number().int().min(1).max(99)
});

export const cartSchema = z.object({
  items: z.array(cartLineSchema).min(1).max(50)
});

export const variantInputSchema = z.object({
  id: id.optional(),
  sku: nonEmpty.max(80),
  name: nonEmpty.max(120),
  price: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  lengthCm: z.number().int().positive().nullable().optional(),
  widthCm: z.number().int().positive().nullable().optional(),
  heightCm: z.number().int().positive().nullable().optional(),
  stockOnHand: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().default(5),
  isActive: z.boolean().default(true)
});

export const productInputSchema = z.object({
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: nonEmpty.max(160),
  description: z.string().trim().max(5000).default(""),
  status: z.enum(["draft", "active", "archived"]),
  variants: z.array(variantInputSchema).min(1).max(50)
});

export const destinationSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
});

export const shippingQuoteRequestSchema = cartSchema.extend({
  destinationId: nonEmpty.max(100),
  destinationLabel: nonEmpty.max(300)
});

export const checkoutSchema = cartSchema.extend({
  shippingQuoteId: id,
  idempotencyKey: z.string().trim().min(16).max(128),
  turnstileToken: z.string().max(2048).default(""),
  customer: z.object({
    name: nonEmpty.max(160),
    email: z.email().max(254),
    phone: z.string().trim().min(8).max(30)
  }),
  address: z.object({
    destinationId: nonEmpty.max(100),
    destinationLabel: nonEmpty.max(300),
    addressLine: nonEmpty.max(1000),
    postalCode: z.string().trim().min(4).max(10)
  }),
  customerNote: z.string().trim().max(1000).default("")
});

export const publicOrderLookupSchema = z.object({
  token: z.string().min(32).max(256)
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["paid", "processing", "shipped", "delivered", "cancelled"]),
  courierName: z.string().trim().max(120).optional(),
  airwayBill: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).default("")
}).superRefine((value, context) => {
  if (value.status === "shipped" && (!value.courierName || !value.airwayBill)) {
    context.addIssue({
      code: "custom",
      message: "Courier and airway bill are required when shipping an order"
    });
  }
});

export const inventoryAdjustmentSchema = z.object({
  stockOnHand: z.number().int().nonnegative(),
  note: nonEmpty.max(500)
});

export const pushSubscriptionSchema = z.object({
  token: z.string().min(32).max(256),
  endpoint: z.url().max(2000),
  keys: z.object({
    p256dh: nonEmpty.max(256),
    auth: nonEmpty.max(256)
  })
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type ShippingQuoteRequest = z.infer<typeof shippingQuoteRequestSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderStatusUpdate = z.infer<typeof orderStatusUpdateSchema>;

