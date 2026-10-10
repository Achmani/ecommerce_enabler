export type ProductVariant = {
  id: string;
  sku: string;
  name: string;
  price: number;
  weightGrams: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  stockOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
};

export type ProductImage = {
  id: string;
  url: string;
  altText: string;
  sortOrder: number;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  variants: ProductVariant[];
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
};

export type Destination = {
  id: string;
  label: string;
  province?: string;
  city?: string;
  district?: string;
  subdistrict?: string;
  postalCode?: string;
};

export type ShippingQuote = {
  id: string;
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceDescription: string;
  cost: number;
  etd: string | null;
  expiresAt: string;
};

export type PaymentView = {
  status: "pending" | "paid" | "expired" | "failed" | "cancelled";
  provider: string;
  checkoutUrl: string | null;
  qrString: string | null;
  expiresAt: string;
};

export type OrderSummary = {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  subtotal: number;
  shippingCost: number;
  grandTotal: number;
  courierName: string;
  shippingService: string;
  airwayBill: string | null;
  createdAt: string;
  payment: PaymentView | null;
};

export type ApiSuccess<T> = { data: T; requestId: string };
export type ApiFailure = {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
};

