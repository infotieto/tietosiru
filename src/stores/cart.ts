import { persistentAtom } from '@nanostores/persistent';

export type CartItem = {
  id: string;
  name: string;
  price_cents: number;
  vat_percent: number;
  qty: number;
};

export type CartState = {
  items: CartItem[];
  updatedAt: number;
};

export const cartState = persistentAtom<CartState>('cart', { items: [], updatedAt: Date.now() }, {
  encode: JSON.stringify,
  decode: JSON.parse,
});

// Evict after 7 days (PLAN section 4, section 9.1)
try {
  const raw = cartState.get();
  if (raw?.updatedAt && Date.now() - raw.updatedAt > 7 * 24 * 60 * 60 * 1000) {
    cartState.set({ items: [], updatedAt: Date.now() });
  }
} catch {
  // ignore parse errors on old localStorage
}

export function addToCart(item: CartItem): void {
  const s = cartState.get();
  const idx = s.items.findIndex((i) => i.id === item.id);
  let next: CartItem[];
  if (idx >= 0) {
    next = s.items.map((i, n) => (n === idx ? { ...i, qty: i.qty + item.qty } : i));
  } else {
    next = [...s.items, item];
  }
  cartState.set({ items: next, updatedAt: Date.now() });
}

export function removeFromCart(id: string): void {
  const s = cartState.get();
  cartState.set({ items: s.items.filter((i) => i.id !== id), updatedAt: Date.now() });
}

export function setQty(id: string, qty: number): void {
  const s = cartState.get();
  if (qty <= 0) return removeFromCart(id);
  cartState.set({ items: s.items.map((i) => (i.id === id ? { ...i, qty } : i)), updatedAt: Date.now() });
}

export function clearCart(): void {
  cartState.set({ items: [], updatedAt: Date.now() });
}

export function cartTotalCents(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.price_cents * i.qty, 0);
}
