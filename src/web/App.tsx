import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useCart } from "./cart-context";
import { HomePage } from "./pages/HomePage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderPage } from "./pages/OrderPage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  const cart = useCart();
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Teman Makan home">
          <span className="brand-mark">TM</span>
          <span>Teman Makan</span>
        </Link>
        <nav>
          <NavLink to="/">Beranda</NavLink>
          <a href="/#produk">Produk</a>
          <NavLink to="/checkout" className="cart-link">Keranjang <strong>{cart.count}</strong></NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order/:orderNumber" element={<OrderPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<main className="empty-state"><h1>Halaman tidak ditemukan</h1><Link className="button" to="/">Kembali</Link></main>} />
      </Routes>
      <footer className="site-footer">
        <div><strong>Teman Makan</strong><p>Sambal bawang dan teman makan lainnya.</p></div>
        <Link to="/admin">Dashboard</Link>
      </footer>
    </div>
  );
}

