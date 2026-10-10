import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import type { OrderSummary } from "../../shared/types";
import { api, rupiah } from "../api";

type PublicConfig = { turnstileSiteKey: string; vapidPublicKey: string; pushEnabled: boolean };

export function OrderPage() {
  const { orderNumber = "" } = useParams();
  const token = sessionStorage.getItem(`order-token:${orderNumber}`) ?? "";
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [message, setMessage] = useState("");
  const [pushState, setPushState] = useState<"idle" | "busy" | "enabled">("idle");

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setOrder(await api<OrderSummary>(`/api/orders/${encodeURIComponent(orderNumber)}/lookup`, {
        method: "POST",
        body: JSON.stringify({ token })
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pesanan tidak dapat dimuat");
    }
  }, [orderNumber, token]);

  useEffect(() => {
    void refresh();
    void api<PublicConfig>("/api/config").then(setConfig);
  }, [refresh]);

  useEffect(() => {
    if (!order || !["pending_payment", "paid", "processing", "shipped"].includes(order.status)) return;
    const interval = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(interval);
  }, [order, refresh]);

  async function enablePush() {
    if (!config?.vapidPublicKey || !token) return;
    setPushState("busy");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.vapidPublicKey)
      });
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
        throw new Error("Browser tidak memberikan data langganan lengkap");
      }
      await api(`/api/orders/${encodeURIComponent(orderNumber)}/push-subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          token,
          endpoint: serialized.endpoint,
          keys: serialized.keys
        })
      });
      setPushState("enabled");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notifikasi belum dapat diaktifkan");
      setPushState("idle");
    }
  }

  if (!token) return (
    <main className="empty-state"><h1>Tautan pesanan tidak lengkap</h1><p>Buka halaman ini dari konfirmasi checkout pada browser yang sama.</p><Link className="button button-primary" to="/">Kembali ke toko</Link></main>
  );
  if (!order) return <main className="empty-state"><h1>Memuat pesanan…</h1>{message && <div className="notice error">{message}</div>}</main>;

  return (
    <main className="order-page section">
      <div className="order-confirmation">
        <span className={`status-badge status-${order.status}`}>{statusLabel(order.status)}</span>
        <p className="eyebrow">Pesanan {order.orderNumber}</p>
        <h1>{order.paymentStatus === "pending" ? "Selesaikan pembayaran" : "Terima kasih, teman!"}</h1>
        <p>Konfirmasi dan perubahan status akan dikirim ke <strong>{order.customerEmail}</strong>.</p>
      </div>
      {message && <div className="notice error">{message}</div>}
      <div className="order-grid">
        <section className="payment-card">
          {order.paymentStatus === "pending" ? <>
            <h2>Bayar dengan QRIS</h2>
            {order.payment?.qrString ? <QRCodeSVG value={order.payment.qrString} size={240} level="M" includeMargin /> : order.payment?.checkoutUrl ? <a className="button button-primary" href={order.payment.checkoutUrl}>Buka halaman pembayaran</a> : <div className="mock-payment"><span>MODE LOKAL</span><p>Gunakan tombol “Simulasikan pembayaran” pada dashboard admin.</p></div>}
            <p className="muted">Berlaku sampai {order.payment ? new Date(order.payment.expiresAt).toLocaleString("id-ID") : "-"}</p>
          </> : <>
            <div className="success-mark">✓</div><h2>Pembayaran diterima</h2><p>Pesananmu sekarang berstatus <strong>{statusLabel(order.status)}</strong>.</p>
          </>}
        </section>
        <aside className="order-details">
          <h2>Detail pesanan</h2>
          <span>Subtotal <b>{rupiah(order.subtotal)}</b></span>
          <span>Pengiriman <b>{rupiah(order.shippingCost)}</b></span>
          <span>Kurir <b>{order.courierName} {order.shippingService}</b></span>
          {order.airwayBill && <span>Nomor resi <b>{order.airwayBill}</b></span>}
          <span className="grand">Total <b>{rupiah(order.grandTotal)}</b></span>
          {config?.pushEnabled && <button className="button button-secondary full" disabled={pushState !== "idle"} onClick={() => void enablePush()}>{pushState === "enabled" ? "Notifikasi aktif ✓" : pushState === "busy" ? "Mengaktifkan…" : "Aktifkan notifikasi browser"}</button>}
          <button className="text-button" onClick={() => void refresh()}>Perbarui status</button>
        </aside>
      </div>
    </main>
  );
}

function statusLabel(status: string): string {
  return ({
    pending_payment: "Menunggu pembayaran",
    paid: "Sudah dibayar",
    processing: "Sedang disiapkan",
    shipped: "Dalam pengiriman",
    delivered: "Sudah diterima",
    expired: "Pembayaran kedaluwarsa",
    cancelled: "Dibatalkan"
  } as Record<string, string>)[status] ?? status;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

