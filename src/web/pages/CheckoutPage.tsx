import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Destination, Product, ShippingQuote } from "../../shared/types";
import { api, rupiah } from "../api";
import { useCart } from "../cart-context";

type PublicConfig = { turnstileSiteKey: string; vapidPublicKey: string; pushEnabled: boolean };
type OrderCreation = { order: { orderNumber: string }; accessToken: string };

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [quoteId, setQuoteId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void Promise.all([api<Product[]>("/api/products"), api<PublicConfig>("/api/config")])
      .then(([productData, configData]) => { setProducts(productData); setConfig(configData); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Checkout belum dapat dimuat"));
  }, []);

  const rows = useMemo(() => cart.items.flatMap((line) => {
    for (const product of products) {
      const variant = product.variants.find((candidate) => candidate.id === line.variantId);
      if (variant) return [{ line, product, variant }];
    }
    return [];
  }), [cart.items, products]);
  const subtotal = rows.reduce((total, row) => total + row.variant.price * row.line.quantity, 0);
  const selectedQuote = quotes.find((quote) => quote.id === quoteId);

  async function findDestinations(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      setDestinations(await api<Destination[]>(`/api/shipping/destinations?q=${encodeURIComponent(destinationQuery)}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lokasi tidak ditemukan");
    }
  }

  async function calculateShipping(selected: Destination) {
    setDestination(selected);
    setDestinations([]);
    setQuotes([]);
    setQuoteId("");
    setBusy(true);
    try {
      const data = await api<ShippingQuote[]>("/api/shipping/quotes", {
        method: "POST",
        body: JSON.stringify({
          items: cart.items,
          destinationId: selected.id,
          destinationLabel: selected.label
        })
      });
      setQuotes(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ongkir belum dapat dihitung");
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination || !quoteId) return setMessage("Pilih tujuan dan layanan pengiriman");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await api<OrderCreation>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.items,
          shippingQuoteId: quoteId,
          idempotencyKey,
          turnstileToken,
          customer: {
            name: form.get("name"),
            email: form.get("email"),
            phone: form.get("phone")
          },
          address: {
            destinationId: destination.id,
            destinationLabel: destination.label,
            addressLine: form.get("addressLine"),
            postalCode: form.get("postalCode")
          },
          customerNote: form.get("customerNote")
        })
      });
      sessionStorage.setItem(`order-token:${result.order.orderNumber}`, result.accessToken);
      cart.clear();
      void navigate(`/order/${encodeURIComponent(result.order.orderNumber)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pesanan belum dapat dibuat");
    } finally {
      setBusy(false);
    }
  }

  if (cart.items.length === 0) return (
    <main className="empty-state"><h1>Keranjangmu masih kosong</h1><p>Pilih sambal yang ingin menemani makanmu.</p><Link className="button button-primary" to="/#produk">Lihat produk</Link></main>
  );

  return (
    <main className="checkout-page section">
      <div className="page-title"><p className="eyebrow">Checkout</p><h1>Selesaikan pesananmu</h1></div>
      {message && <div className="notice error">{message}</div>}
      <div className="checkout-grid">
        <form className="checkout-form" onSubmit={(event) => void submitOrder(event)}>
          <section className="form-card">
            <span className="step">01</span><h2>Kontak</h2>
            <div className="form-grid">
              <label>Nama lengkap<input required name="name" autoComplete="name" /></label>
              <label>Email<input required type="email" name="email" autoComplete="email" /></label>
              <label>Nomor WhatsApp/telepon<input required name="phone" autoComplete="tel" /></label>
            </div>
          </section>
          <section className="form-card">
            <span className="step">02</span><h2>Alamat pengiriman</h2>
            <div className="destination-search">
              <input value={destinationQuery} onChange={(event) => setDestinationQuery(event.target.value)} placeholder="Cari kecamatan, kota, atau kode pos" />
              <button type="button" onClick={(event) => void findDestinations(event)}>Cari</button>
            </div>
            {destinations.length > 0 && <div className="search-results">{destinations.map((item) => <button type="button" key={item.id} onClick={() => void calculateShipping(item)}><strong>{item.label}</strong><small>{[item.province, item.postalCode].filter(Boolean).join(" · ")}</small></button>)}</div>}
            {destination && <div className="selected-destination">Tujuan: <strong>{destination.label}</strong></div>}
            <label>Alamat lengkap<textarea required name="addressLine" rows={3} placeholder="Nama jalan, nomor, RT/RW, patokan" /></label>
            <label>Kode pos<input required name="postalCode" defaultValue={destination?.postalCode ?? ""} /></label>
          </section>
          <section className="form-card">
            <span className="step">03</span><h2>Pilih pengiriman</h2>
            {busy && quotes.length === 0 ? <p>Menghitung ongkir…</p> : quotes.length === 0 ? <p className="muted">Pilih alamat tujuan untuk melihat pilihan kurir.</p> : <div className="quote-list">{quotes.map((quote) => <label className={quoteId === quote.id ? "selected" : ""} key={quote.id}><input type="radio" name="quote" value={quote.id} checked={quoteId === quote.id} onChange={() => setQuoteId(quote.id)} /><span><strong>{quote.courierName} {quote.serviceCode}</strong><small>{quote.serviceDescription} · estimasi {quote.etd ?? "-"}</small></span><b>{rupiah(quote.cost)}</b></label>)}</div>}
          </section>
          <section className="form-card">
            <span className="step">04</span><h2>Catatan</h2>
            <label>Catatan untuk pesanan (opsional)<textarea name="customerNote" rows={2} /></label>
            {config && <Turnstile siteKey={config.turnstileSiteKey} onToken={setTurnstileToken} />}
            <button className="button button-primary full" disabled={busy || !quoteId}>{busy ? "Memproses…" : `Bayar ${rupiah(subtotal + (selectedQuote?.cost ?? 0))}`}</button>
            <p className="fine-print">Dengan melanjutkan, kamu menyetujui pemrosesan data untuk pembayaran dan pengiriman pesanan.</p>
          </section>
        </form>
        <aside className="order-summary">
          <h2>Ringkasan</h2>
          {rows.map(({ line, product, variant }) => <div className="summary-line" key={variant.id}><div><strong>{product.name}</strong><small>{variant.name} · {rupiah(variant.price)}</small><div className="quantity"><button onClick={() => cart.setQuantity(variant.id, line.quantity - 1)}>−</button><span>{line.quantity}</span><button onClick={() => cart.setQuantity(variant.id, line.quantity + 1)}>+</button><button className="remove" onClick={() => cart.remove(variant.id)}>Hapus</button></div></div><b>{rupiah(variant.price * line.quantity)}</b></div>)}
          <div className="totals"><span>Subtotal <b>{rupiah(subtotal)}</b></span><span>Ongkir <b>{selectedQuote ? rupiah(selectedQuote.cost) : "—"}</b></span><span className="grand">Total <b>{rupiah(subtotal + (selectedQuote?.cost ?? 0))}</b></span></div>
        </aside>
      </div>
    </main>
  );
}

function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId = "";
    const render = () => {
      if (window.turnstile && container.current && !widgetId) {
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: onToken,
          "expired-callback": () => onToken("")
        });
      }
    };
    let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      document.head.append(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      script?.removeEventListener("load", render);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onToken]);
  return siteKey ? <div ref={container} className="turnstile" /> : <p className="local-badge">Turnstile dilewati pada pengembangan lokal.</p>;
}
