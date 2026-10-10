import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { CartContext, type CartLine } from "./cart-context";

const storageKey = "teman-makan-cart-v1";

export function CartProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<CartLine[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value): CartLine[] => {
        if (!value || typeof value !== "object") return [];
        const record = value as Record<string, unknown>;
        return typeof record.variantId === "string" && typeof record.quantity === "number"
          ? [{ variantId: record.variantId, quantity: Math.max(1, Math.min(99, Math.floor(record.quantity))) }]
          : [];
      });
    } catch {
      return [];
    }
  });

  useEffect(() => localStorage.setItem(storageKey, JSON.stringify(items)), [items]);

  const value = useMemo(() => ({
    items,
    add(variantId: string) {
      setItems((current) => {
        const found = current.find((line) => line.variantId === variantId);
        return found
          ? current.map((line) => line.variantId === variantId ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line)
          : [...current, { variantId, quantity: 1 }];
      });
    },
    setQuantity(variantId: string, quantity: number) {
      setItems((current) => current.map((line) => line.variantId === variantId
        ? { ...line, quantity: Math.max(1, Math.min(99, Math.floor(quantity))) }
        : line));
    },
    remove(variantId: string) {
      setItems((current) => current.filter((line) => line.variantId !== variantId));
    },
    clear() { setItems([]); },
    count: items.reduce((total, line) => total + line.quantity, 0)
  }), [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

