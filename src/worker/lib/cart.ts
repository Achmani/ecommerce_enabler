import type { CartLineInput } from "../../shared/schemas";
import { ApiError, sha256 } from "./core";

export type AuthoritativeCartItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  weightGrams: number;
  quantity: number;
  availableQuantity: number;
};

export type AuthoritativeCart = {
  items: AuthoritativeCartItem[];
  subtotal: number;
  totalWeightGrams: number;
  fingerprint: string;
};

type CartRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  price: number;
  weight_grams: number;
  stock_on_hand: number;
  reserved_quantity: number;
  product_status: string;
  is_active: number;
};

export async function resolveCart(db: D1Database, lines: CartLineInput[]): Promise<AuthoritativeCart> {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    const next = (quantities.get(line.variantId) ?? 0) + line.quantity;
    if (next > 99) throw new ApiError(422, "quantity_too_large", "Maximum quantity per item is 99");
    quantities.set(line.variantId, next);
  }

  const variantIds = [...quantities.keys()];
  const placeholders = variantIds.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, v.name AS variant_name,
            v.sku, v.price, v.weight_grams, v.stock_on_hand, v.reserved_quantity,
            p.status AS product_status, v.is_active
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${placeholders})`
  ).bind(...variantIds).all<CartRow>();

  if (result.results.length !== variantIds.length) {
    throw new ApiError(422, "cart_item_unavailable", "One or more cart items are unavailable");
  }

  const items: AuthoritativeCartItem[] = result.results.map((row) => {
    const quantity = quantities.get(row.variant_id) ?? 0;
    const availableQuantity = row.stock_on_hand - row.reserved_quantity;
    if (row.product_status !== "active" || row.is_active !== 1) {
      throw new ApiError(422, "cart_item_unavailable", `${row.product_name} is not available`);
    }
    if (availableQuantity < quantity) {
      throw new ApiError(409, "insufficient_stock", `Only ${availableQuantity} unit(s) of ${row.product_name} are available`);
    }
    return {
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      variantName: row.variant_name,
      sku: row.sku,
      unitPrice: row.price,
      weightGrams: row.weight_grams,
      quantity,
      availableQuantity
    };
  }).sort((left, right) => left.variantId.localeCompare(right.variantId));

  const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const totalWeightGrams = items.reduce((total, item) => total + item.weightGrams * item.quantity, 0);
  const fingerprint = await sha256(JSON.stringify(items.map((item) => [
    item.variantId, item.quantity, item.unitPrice, item.weightGrams
  ])));

  return { items, subtotal, totalWeightGrams, fingerprint };
}

