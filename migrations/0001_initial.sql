PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  weight_grams INTEGER NOT NULL CHECK (weight_grams > 0),
  length_cm INTEGER CHECK (length_cm IS NULL OR length_cm > 0),
  width_cm INTEGER CHECK (width_cm IS NULL OR width_cm > 0),
  height_cm INTEGER CHECK (height_cm IS NULL OR height_cm > 0),
  stock_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= stock_on_hand),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE shipping_quotes (
  id TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  courier_code TEXT NOT NULL,
  courier_name TEXT NOT NULL,
  service_code TEXT NOT NULL,
  service_description TEXT NOT NULL DEFAULT '',
  cost INTEGER NOT NULL CHECK (cost >= 0),
  etd TEXT,
  total_weight_grams INTEGER NOT NULL CHECK (total_weight_grams > 0),
  cart_fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  public_token_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (
    status IN ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'expired', 'cancelled')
  ),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    payment_status IN ('pending', 'paid', 'expired', 'failed', 'cancelled')
  ),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  address_line TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  shipping_cost INTEGER NOT NULL CHECK (shipping_cost >= 0),
  adjustment_total INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL CHECK (grand_total >= 0),
  shipping_quote_id TEXT NOT NULL REFERENCES shipping_quotes(id),
  courier_code TEXT NOT NULL,
  courier_name TEXT NOT NULL,
  shipping_service TEXT NOT NULL,
  shipping_etd TEXT,
  airway_bill TEXT,
  payment_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  weight_grams INTEGER NOT NULL CHECK (weight_grams > 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'cancelled')),
  payment_reference TEXT,
  checkout_url TEXT,
  qr_string TEXT,
  provider_response TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  payment_id TEXT REFERENCES payments(id),
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(provider, deduplication_key)
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  order_id TEXT REFERENCES orders(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('adjustment', 'reservation', 'release', 'sale')),
  quantity INTEGER NOT NULL CHECK (quantity != 0),
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  deduplication_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  provider_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_images_product_order ON product_images(product_id, sort_order);
CREATE INDEX idx_quotes_expiry ON shipping_quotes(expires_at);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX idx_orders_email ON orders(customer_email);
CREATE UNIQUE INDEX idx_orders_shipping_quote ON orders(shipping_quote_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_movements_variant_created ON inventory_movements(variant_id, created_at DESC);
CREATE INDEX idx_order_events_order_created ON order_events(order_id, created_at DESC);
CREATE UNIQUE INDEX idx_order_events_terminal_once ON order_events(order_id, new_status)
  WHERE new_status IN ('expired', 'cancelled');
CREATE INDEX idx_notifications_status ON notification_deliveries(status, created_at);
