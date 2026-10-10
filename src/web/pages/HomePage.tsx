import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Product } from "../../shared/types";
import { api, rupiah } from "../api";
import { useCart } from "../cart-context";

export function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const cart = useCart();

  useEffect(() => {
    void api<Product[]>("/api/products").then(setProducts).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Produk belum dapat dimuat");
    });
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Satu sambal. Sudah jadi temanmu hari ini.</p>
          <h1>Teman yang bikin <em>nasi hangat</em> nggak biasa.</h1>
          <p className="lead">Teman Makan Sambal Bawang hadir untuk menemani lauk sederhana, makan cepat, sampai cerita panjang di meja makan.</p>
          <div className="actions">
            <a className="button button-primary" href="#produk">Belanja sekarang</a>
            <a className="button button-secondary" href="#cerita">Kenalan dulu</a>
          </div>
          <div className="trust-row">
            <span><strong>Siap makan</strong><small>Tinggal buka</small></span>
            <span><strong>Tanpa pengawet</strong><small>Sesuai label produk</small></span>
            <span><strong>Kirim se-Indonesia</strong><small>Ongkir real-time</small></span>
          </div>
        </div>
        <div className="hero-art">
          <div className="hero-sun" />
          <img src="https://temanmakan.biz.id/assets/mockup-3.webp" alt="Teman Makan Sambal Bawang bersama nasi hangat" />
          <div className="hero-stamp">PEDAS<br/><b>GURIH</b></div>
        </div>
      </section>

      <section className="marquee"><span>Teman nasi hangat ✦ Teman lauk sederhana ✦ Teman cerita di setiap piring ✦</span></section>

      <section className="story section" id="cerita">
        <div className="story-image"><img src="https://temanmakan.biz.id/assets/mockup-1.webp" alt="Jar Teman Makan Sambal Bawang" /></div>
        <div>
          <p className="eyebrow">Cerita Teman Makan</p>
          <h2>Karena makanan enak lebih seru kalau <em>punya teman.</em></h2>
          <p>Teman Makan lahir dari hal sederhana: nasi hangat, lauk di meja, lalu satu sendok sambal yang membuat semuanya terasa lebih lengkap.</p>
          <blockquote>“Satu sambal sudah jadi temanmu hari ini.”</blockquote>
        </div>
      </section>

      <section className="section products-section" id="produk">
        <div className="section-heading">
          <div><p className="eyebrow">Toko online</p><h2>Pilih teman makanmu</h2></div>
          <p>Harga dan stok selalu divalidasi kembali saat checkout.</p>
        </div>
        {error && <div className="notice error">{error}</div>}
        {products.length === 0 && !error ? (
          <div className="empty-state compact">
            <h3>Produk sedang disiapkan</h3>
            <p>Produk yang dipublikasikan melalui dashboard akan tampil di sini.</p>
          </div>
        ) : (
          <div className="product-grid">
            {products.map((product) => <article className="product-card" key={product.id}>
              <div className="product-photo">
                <img src={product.images[0]?.url ?? "https://temanmakan.biz.id/assets/mockup-2.webp"} alt={product.images[0]?.altText ?? product.name} />
              </div>
              <div className="product-body">
                <span className="pill">SIAP MAKAN</span>
                <h3>{product.name}</h3>
                <p>{product.description}</p>
                {product.variants.map((variant) => <div className="variant-row" key={variant.id}>
                  <div><strong>{variant.name}</strong><small>{variant.weightGrams} gram · stok {variant.availableQuantity}</small></div>
                  <div className="variant-buy"><b>{rupiah(variant.price)}</b><button disabled={variant.availableQuantity < 1} onClick={() => cart.add(variant.id)}>{variant.availableQuantity < 1 ? "Habis" : "+ Keranjang"}</button></div>
                </div>)}
              </div>
            </article>)}
          </div>
        )}
        {cart.count > 0 && <div className="floating-cart"><span>{cart.count} item di keranjang</span><Link className="button button-light" to="/checkout">Checkout →</Link></div>}
      </section>
    </main>
  );
}

