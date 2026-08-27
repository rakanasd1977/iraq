import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { load, save } from '../store';
import type { CartContextValue, CartItem, CartProviderGroup, ItemKind } from '../types';

const CART_KEY = 'cart_v1';
const CartContext = createContext<CartContextValue | null>(null);

function makeId(providerId: number | string, kind: ItemKind, itemId: number | string): string {
  return `${providerId}:${kind}:${itemId}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => load(CART_KEY, []));

  useEffect(() => {
    save(CART_KEY, items);
  }, [items]);

  const addItem = useCallback((entry: CartItem) => {
    setItems((prev) => {
      const existing = prev.find(
        (it) => it.provider_id === entry.provider_id && it.kind === entry.kind && it.item_id === entry.item_id
      );
      if (existing) {
        return prev.map((it) =>
          it.provider_id === entry.provider_id && it.kind === entry.kind && it.item_id === entry.item_id
            ? { ...it, quantity: it.quantity + entry.quantity }
            : it
        );
      }
      return [...prev, { ...entry, quantity: entry.quantity || 1 }];
    });
  }, []);

  const setQuantity = useCallback((providerId: number | string, kind: ItemKind, itemId: number | string, quantity: number) => {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((it) => !(it.provider_id === providerId && it.kind === kind && it.item_id === itemId))
        : prev.map((it) =>
            it.provider_id === providerId && it.kind === kind && it.item_id === itemId ? { ...it, quantity } : it
          )
    );
  }, []);

  const removeItem = useCallback((providerId: number | string, kind: ItemKind, itemId: number | string) => {
    setItems((prev) => prev.filter((it) => !(it.provider_id === providerId && it.kind === kind && it.item_id === itemId)));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // تجميع البنود حسب المزوّد (يُفصل طلب واحد لكل مزوّد)
  const byProvider = useCallback(() => {
    const map = new Map<string, CartProviderGroup>();
    for (const it of items) {
      const key = String(it.provider_id);
      if (!map.has(key)) map.set(key, { provider_id: it.provider_id, provider_name: it.provider_name, items: [] });
      map.get(key)!.items.push(it);
    }
    return [...map.values()];
  }, [items]);

  const totalCount = items.reduce((s, it) => s + it.quantity, 0);
  const totalAmount = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, setQuantity, removeItem, clear, byProvider, totalCount, totalAmount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
