import { createContext, useContext } from "react";

export type CartLine = { variantId: string; quantity: number };

export type CartContextValue = {
  items: CartLine[];
  add: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  count: number;
};

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}

