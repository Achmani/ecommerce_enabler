import type { Product, ProductImage, ProductVariant } from "../../shared/types";
import type { ProductInput } from "../../shared/schemas";
import { ApiError, nowIso } from "./core";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: Product["status"];
  created_at: string;
  updated_at: string;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  price: number;
  weight_grams: number;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  stock_on_hand: number;
  reserved_quantity: number;
  low_stock_threshold: number;
  is_active: number;
};

type ImageRow = {
  id: string;
  product_id: string;
  object_key: string;
  alt_text: string;
  sort_order: number;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export async function listProducts(db: D1Database, publicOnly: boolean): Promise<Product[]> {
  const productResult = await db
    .prepare(
      `SELECT id, slug, name, description, status, created_at, updated_at
       FROM products ${publicOnly ? "WHERE status = 'active'" : ""}
       ORDER BY created_at DESC`
    )
    .all<ProductRow>();
  const rows = productResult.results;
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const bindings = placeholders(ids.length);
  const [variantResult, imageResult] = await Promise.all([
    db.prepare(
      `SELECT id, product_id, sku, name, price, weight_grams, length_cm, width_cm, height_cm,
              stock_on_hand, reserved_quantity, low_stock_threshold, is_active
       FROM product_variants WHERE product_id IN (${bindings}) ORDER BY created_at`
    ).bind(...ids).all<VariantRow>(),
    db.prepare(
      `SELECT id, product_id, object_key, alt_text, sort_order
       FROM product_images WHERE product_id IN (${bindings}) ORDER BY sort_order, created_at`
    ).bind(...ids).all<ImageRow>()
  ]);

  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const row of variantResult.results) {
    if (publicOnly && row.is_active !== 1) continue;
    const variants = variantsByProduct.get(row.product_id) ?? [];
    variants.push({
      id: row.id,
      sku: row.sku,
      name: row.name,
      price: row.price,
      weightGrams: row.weight_grams,
      lengthCm: row.length_cm,
      widthCm: row.width_cm,
      heightCm: row.height_cm,
      stockOnHand: row.stock_on_hand,
      reservedQuantity: row.reserved_quantity,
      availableQuantity: row.stock_on_hand - row.reserved_quantity,
      lowStockThreshold: row.low_stock_threshold,
      isActive: row.is_active === 1
    });
    variantsByProduct.set(row.product_id, variants);
  }

  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const row of imageResult.results) {
    const images = imagesByProduct.get(row.product_id) ?? [];
    images.push({
      id: row.id,
      url: `/media/${row.object_key}`,
      altText: row.alt_text,
      sortOrder: row.sort_order
    });
    imagesByProduct.set(row.product_id, images);
  }

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    variants: variantsByProduct.get(row.id) ?? [],
    images: imagesByProduct.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getProduct(db: D1Database, id: string, publicOnly = false): Promise<Product> {
  const products = await listProducts(db, publicOnly);
  const product = products.find((candidate) => candidate.id === id || candidate.slug === id);
  if (!product) throw new ApiError(404, "product_not_found", "Product was not found");
  return product;
}

export async function createProduct(
  db: D1Database,
  input: ProductInput,
  adminEmail: string
): Promise<string> {
  const productId = crypto.randomUUID();
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO products (id, slug, name, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(productId, input.slug, input.name, input.description, input.status, timestamp, timestamp)
  ];

  for (const variant of input.variants) {
    const variantId = variant.id ?? crypto.randomUUID();
    statements.push(
      db.prepare(
        `INSERT INTO product_variants
         (id, product_id, sku, name, price, weight_grams, length_cm, width_cm, height_cm,
          stock_on_hand, reserved_quantity, low_stock_threshold, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      ).bind(
        variantId, productId, variant.sku, variant.name, variant.price,
        variant.weightGrams, variant.lengthCm ?? null, variant.widthCm ?? null, variant.heightCm ?? null,
        variant.stockOnHand, variant.lowStockThreshold, variant.isActive ? 1 : 0, timestamp, timestamp
      )
    );
    if (variant.stockOnHand > 0) {
      statements.push(inventoryMovementStatement(
        db, variantId, variant.stockOnHand, "Initial stock", adminEmail, timestamp
      ));
    }
  }
  statements.push(auditStatement(db, adminEmail, "product.create", "product", productId, input.name, timestamp));
  await executeBatch(db, statements);
  return productId;
}

export async function updateProduct(
  db: D1Database,
  productId: string,
  input: ProductInput,
  adminEmail: string
): Promise<void> {
  const existing = await getProduct(db, productId);
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE products SET slug = ?, name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`
    ).bind(input.slug, input.name, input.description, input.status, timestamp, productId)
  ];
  const retainedIds = new Set<string>();

  for (const variant of input.variants) {
    const variantId = variant.id ?? crypto.randomUUID();
    const existingVariant = variant.id
      ? existing.variants.find((candidate) => candidate.id === variant.id)
      : undefined;
    if (variant.id && !existingVariant) {
      throw new ApiError(422, "variant_product_mismatch", "A variant does not belong to this product");
    }
    if (existingVariant && variant.stockOnHand < existingVariant.reservedQuantity) {
      throw new ApiError(409, "stock_below_reservations", "Stock cannot be lower than reserved quantity");
    }
    retainedIds.add(variantId);
    statements.push(
      db.prepare(
        `INSERT INTO product_variants
         (id, product_id, sku, name, price, weight_grams, length_cm, width_cm, height_cm,
          stock_on_hand, reserved_quantity, low_stock_threshold, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sku = excluded.sku, name = excluded.name, price = excluded.price,
           weight_grams = excluded.weight_grams, length_cm = excluded.length_cm,
           width_cm = excluded.width_cm, height_cm = excluded.height_cm,
           stock_on_hand = excluded.stock_on_hand, low_stock_threshold = excluded.low_stock_threshold,
           is_active = excluded.is_active, updated_at = excluded.updated_at`
      ).bind(
        variantId, productId, variant.sku, variant.name, variant.price, variant.weightGrams,
        variant.lengthCm ?? null, variant.widthCm ?? null, variant.heightCm ?? null,
        variant.stockOnHand, variant.lowStockThreshold, variant.isActive ? 1 : 0, timestamp, timestamp
      )
    );
    const stockDifference = variant.stockOnHand - (existingVariant?.stockOnHand ?? 0);
    if (stockDifference !== 0) {
      statements.push(inventoryMovementStatement(
        db,
        variantId,
        stockDifference,
        existingVariant ? "Stock changed with product update" : "Initial stock",
        adminEmail,
        timestamp
      ));
    }
  }

  for (const existingVariant of existing.variants) {
    if (!retainedIds.has(existingVariant.id)) {
      statements.push(
        db.prepare("UPDATE product_variants SET is_active = 0, updated_at = ? WHERE id = ?")
          .bind(timestamp, existingVariant.id)
      );
    }
  }
  statements.push(auditStatement(db, adminEmail, "product.update", "product", productId, input.name, timestamp));
  await executeBatch(db, statements);
}

export async function archiveProduct(db: D1Database, productId: string, adminEmail: string): Promise<void> {
  await getProduct(db, productId);
  const timestamp = nowIso();
  await executeBatch(db, [
    db.prepare("UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?").bind(timestamp, productId),
    auditStatement(db, adminEmail, "product.archive", "product", productId, "Product archived", timestamp)
  ]);
}

export async function adjustInventory(
  db: D1Database,
  variantId: string,
  stockOnHand: number,
  note: string,
  adminEmail: string
): Promise<void> {
  const current = await db.prepare(
    "SELECT stock_on_hand, reserved_quantity FROM product_variants WHERE id = ?"
  ).bind(variantId).first<{ stock_on_hand: number; reserved_quantity: number }>();
  if (!current) throw new ApiError(404, "variant_not_found", "Product variant was not found");
  if (stockOnHand < current.reserved_quantity) {
    throw new ApiError(409, "stock_below_reservations", "Stock cannot be lower than reserved quantity");
  }
  const difference = stockOnHand - current.stock_on_hand;
  if (difference === 0) return;
  const timestamp = nowIso();
  await executeBatch(db, [
    db.prepare("UPDATE product_variants SET stock_on_hand = ?, updated_at = ? WHERE id = ?")
      .bind(stockOnHand, timestamp, variantId),
    db.prepare(
      `INSERT INTO inventory_movements
       (id, variant_id, order_id, movement_type, quantity, note, actor, created_at)
       VALUES (?, ?, NULL, 'adjustment', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), variantId, difference, note, adminEmail, timestamp),
    auditStatement(db, adminEmail, "inventory.adjust", "variant", variantId, note, timestamp)
  ]);
}

export async function addProductImage(
  db: D1Database,
  productId: string,
  objectKey: string,
  altText: string,
  sortOrder: number,
  adminEmail: string
): Promise<string> {
  await getProduct(db, productId);
  const imageId = crypto.randomUUID();
  const timestamp = nowIso();
  await executeBatch(db, [
    db.prepare(
      `INSERT INTO product_images (id, product_id, object_key, alt_text, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(imageId, productId, objectKey, altText, sortOrder, timestamp),
    auditStatement(db, adminEmail, "product.image.add", "product", productId, objectKey, timestamp)
  ]);
  return imageId;
}

export async function removeProductImage(
  db: D1Database,
  productId: string,
  imageId: string,
  adminEmail: string
): Promise<string> {
  const image = await db.prepare(
    "SELECT object_key FROM product_images WHERE id = ? AND product_id = ?"
  ).bind(imageId, productId).first<{ object_key: string }>();
  if (!image) throw new ApiError(404, "product_image_not_found", "Product image was not found");
  const timestamp = nowIso();
  await executeBatch(db, [
    db.prepare("DELETE FROM product_images WHERE id = ?").bind(imageId),
    auditStatement(db, adminEmail, "product.image.remove", "product", productId, image.object_key, timestamp)
  ]);
  return image.object_key;
}

function auditStatement(
  db: D1Database,
  email: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  timestamp: string
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_log (id, admin_email, action, entity_type, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), email, action, entityType, entityId, summary, timestamp);
}

function inventoryMovementStatement(
  db: D1Database,
  variantId: string,
  quantity: number,
  note: string,
  actor: string,
  timestamp: string
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO inventory_movements
     (id, variant_id, order_id, movement_type, quantity, note, actor, created_at)
     VALUES (?, ?, NULL, 'adjustment', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), variantId, quantity, note, actor, timestamp);
}

async function executeBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw new ApiError(409, "unique_value_conflict", "Slug or SKU is already in use");
    }
    if (message.includes("CHECK constraint failed")) {
      throw new ApiError(409, "data_constraint_failed", "The change conflicts with current inventory data");
    }
    throw error;
  }
}
