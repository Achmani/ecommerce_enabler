import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { OrderSummary, Product } from "../../shared/types";
import { api, rupiah } from "../api";

type Dashboard = { totalOrders: number; paidSales: number; pendingFulfillment: number; lowStockVariants: number };
type AdminOrder = OrderSummary & { id: string };
type NotificationRow = { id: string; order_number: string; event_type: string; channel: string; status: string; attempts: number; last_error: string | null };
type Health = { environment: string };
type ProductForm = {
  slug: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  variants: Array<{
    id?: string;
    sku: string;
    name: string;
    price: number;
    weightGrams: number;
    stockOnHand: number;
    lowStockThreshold: number;
    isActive: boolean;
  }>;
};

const blankProduct: ProductForm = {
  slug: "",
  name: "",
  description: "",
  status: "draft" as const,
  variants: [{ sku: "", name: "Jar", price: 0, weightGrams: 250, stockOnHand: 0, lowStockThreshold: 5, isActive: true }]
};

export function AdminPage() {
  const [tab, setTab] = useState<"overview" | "products" | "orders" | "notifications">("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [environment, setEnvironment] = useState("production");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dashboardData, productData, orderData, notificationData, health] = await Promise.all([
        api<Dashboard>("/api/admin/dashboard"),
        api<Product[]>("/api/admin/products"),
        api<AdminOrder[]>("/api/admin/orders"),
        api<NotificationRow[]>("/api/admin/notifications"),
        api<Health>("/api/health")
      ]);
      setDashboard(dashboardData);
      setProducts(productData);
      setOrders(orderData);
      setNotifications(notificationData);
      setEnvironment(health.environment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dashboard tidak dapat dimuat");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function changeOrder(order: AdminOrder, status: string) {
    let courierName: string | undefined;
    let airwayBill: string | undefined;
    if (status === "shipped") {
      courierName = window.prompt("Nama kurir", order.courierName) ?? undefined;
      airwayBill = window.prompt("Nomor resi") ?? undefined;
      if (!courierName || !airwayBill) return;
    }
    setBusy(true);
    try {
      await api(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, courierName, airwayBill, note: `Updated from dashboard to ${status}` })
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status belum dapat diubah");
    } finally { setBusy(false); }
  }

  async function simulatePayment(order: AdminOrder) {
    setBusy(true);
    try {
      await api(`/api/admin/orders/${order.id}/mock-payment`, { method: "POST" });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Simulasi gagal"); }
    finally { setBusy(false); }
  }

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div><p className="eyebrow light">Commerce</p><h1>Dashboard</h1></div>
        {(["overview", "products", "orders", "notifications"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{({ overview: "Ringkasan", products: "Produk", orders: "Pesanan", notifications: "Notifikasi" })[item]}</button>)}
        <a href="/">← Lihat toko</a>
      </aside>
      <section className="admin-content">
        <div className="admin-top"><div><p className="eyebrow">Teman Makan</p><h2>{({ overview: "Ringkasan toko", products: "Kelola produk", orders: "Kelola pesanan", notifications: "Pengiriman notifikasi" })[tab]}</h2></div><button className="button button-secondary" onClick={() => void load()}>Perbarui</button></div>
        {message && <div className="notice error">{message}<button onClick={() => setMessage("")}>×</button></div>}
        {tab === "overview" && <div className="metric-grid">
          <Metric label="Total pesanan" value={String(dashboard?.totalOrders ?? 0)} />
          <Metric label="Penjualan dibayar" value={rupiah(dashboard?.paidSales ?? 0)} />
          <Metric label="Perlu diproses" value={String(dashboard?.pendingFulfillment ?? 0)} />
          <Metric label="Stok menipis" value={String(dashboard?.lowStockVariants ?? 0)} />
        </div>}
        {tab === "products" && <>
          <div className="toolbar"><p>{products.length} produk</p><button className="button button-primary" onClick={() => setEditing("new")}>+ Produk baru</button></div>
          <div className="admin-list">{products.map((product) => <article key={product.id} className="admin-product-row"><img src={product.images[0]?.url ?? "https://temanmakan.biz.id/assets/mockup-2.webp"} alt="" /><div><span className={`status-dot ${product.status}`} /> <small>{product.status}</small><h3>{product.name}</h3><p>{product.variants.length} varian · {product.variants.map((variant) => `${variant.sku}: ${variant.availableQuantity}`).join(", ")}</p></div><button onClick={() => setEditing(product)}>Edit</button></article>)}</div>
          {editing && <ProductEditor product={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
        </>}
        {tab === "orders" && <div className="admin-table-wrap"><table><thead><tr><th>Pesanan</th><th>Pelanggan</th><th>Total</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleString("id-ID")}</small></td><td>{order.customerName}<small>{order.customerEmail}</small></td><td>{rupiah(order.grandTotal)}</td><td><span className={`status-badge status-${order.status}`}>{order.status}</span></td><td><div className="table-actions">{environment !== "production" && order.status === "pending_payment" && <button disabled={busy} onClick={() => void simulatePayment(order)}>Simulasi bayar</button>}{order.status === "pending_payment" && <button onClick={() => void changeOrder(order, "cancelled")}>Batalkan</button>}{order.status === "paid" && <button onClick={() => void changeOrder(order, "processing")}>Proses</button>}{order.status === "processing" && <button onClick={() => void changeOrder(order, "shipped")}>Kirim</button>}{order.status === "shipped" && <button onClick={() => void changeOrder(order, "delivered")}>Selesai</button>}</div></td></tr>)}</tbody></table></div>}
        {tab === "notifications" && <div className="admin-table-wrap"><table><thead><tr><th>Pesanan</th><th>Event</th><th>Channel</th><th>Status</th><th>Detail</th></tr></thead><tbody>{notifications.map((row) => <tr key={row.id}><td>{row.order_number}</td><td>{row.event_type}</td><td>{row.channel}</td><td><span className={`status-badge status-${row.status}`}>{row.status}</span></td><td>{row.last_error ?? `${row.attempts} attempt`}{row.status === "failed" && <button onClick={() => void api(`/api/admin/notifications/${row.id}/retry`, { method: "POST" }).then(load)}>Coba lagi</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="metric"><small>{label}</small><strong>{value}</strong></article>;
}

function ProductEditor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<ProductForm>(() => product ? {
    slug: product.slug, name: product.name, description: product.description, status: product.status,
    variants: product.variants.map((variant) => ({
      id: variant.id, sku: variant.sku, name: variant.name, price: variant.price,
      weightGrams: variant.weightGrams, stockOnHand: variant.stockOnHand,
      lowStockThreshold: variant.lowStockThreshold, isActive: variant.isActive
    }))
  } : structuredClone(blankProduct));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function updateVariant(index: number, key: string, value: string | number | boolean) {
    setForm((current) => ({ ...current, variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, [key]: value } : variant) }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await api(product ? `/api/admin/products/${product.id}` : "/api/admin/products", {
        method: product ? "PUT" : "POST",
        body: JSON.stringify(form)
      });
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Produk belum dapat disimpan"); }
    finally { setBusy(false); }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/products/${product.id}/images`, { method: "POST", body: data });
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Gambar belum dapat diunggah"); }
  }

  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><p className="eyebrow">{product ? "Edit" : "Buat"}</p><h2>Produk</h2></div><button onClick={onClose}>×</button></div>{message && <div className="notice error">{message}</div>}<form onSubmit={(event) => void save(event)}><div className="form-grid"><label>Nama<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Slug<input required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></label><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as typeof form.status })}><option value="draft">Draft</option><option value="active">Aktif</option><option value="archived">Arsip</option></select></label></div><label>Deskripsi<textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="variant-editor"><div className="toolbar"><h3>Varian</h3><button type="button" onClick={() => setForm({ ...form, variants: [...form.variants, { sku: "", name: "", price: 0, weightGrams: 100, stockOnHand: 0, lowStockThreshold: 5, isActive: true }] })}>+ Varian</button></div>{form.variants.map((variant, index) => <div className="variant-fields" key={variant.id ?? index}><label>SKU<input required value={variant.sku} onChange={(event) => updateVariant(index, "sku", event.target.value)} /></label><label>Nama<input required value={variant.name} onChange={(event) => updateVariant(index, "name", event.target.value)} /></label><label>Harga<input required type="number" min="0" value={variant.price} onChange={(event) => updateVariant(index, "price", Number(event.target.value))} /></label><label>Berat (g)<input required type="number" min="1" value={variant.weightGrams} onChange={(event) => updateVariant(index, "weightGrams", Number(event.target.value))} /></label><label>Stok<input required type="number" min="0" value={variant.stockOnHand} onChange={(event) => updateVariant(index, "stockOnHand", Number(event.target.value))} /></label><button type="button" className="danger" onClick={() => setForm({ ...form, variants: form.variants.filter((_, itemIndex) => itemIndex !== index) })}>Hapus</button></div>)}</div><div className="modal-actions"><button type="button" onClick={onClose}>Batal</button><button className="button button-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan produk"}</button></div></form>{product && <form className="image-upload" onSubmit={(event) => void uploadImage(event)}><h3>Tambah gambar</h3><input required type="file" name="file" accept="image/jpeg,image/png,image/webp" /><input required name="altText" placeholder="Deskripsi gambar" /><input type="number" name="sortOrder" defaultValue="0" /><button>Unggah</button></form>}</div></div>;
}
