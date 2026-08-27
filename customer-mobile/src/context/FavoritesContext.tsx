import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { customerApi } from '../api';
import type { FavoritesContextValue } from '../types';

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<number>>(() => new Set<number>());
  const [itemIds, setItemIds] = useState<Set<string>>(() => new Set<string>());

  const load = useCallback(async () => {
    if (!user) {
      setIds(new Set<number>());
      setItemIds(new Set<string>());
      return;
    }
    try {
      const [list, itemKeys] = await Promise.all([
        customerApi.favoriteIds(),
        customerApi.itemFavoriteKeys(),
      ]);
      setIds(new Set<number>((list || []).map((n: any) => Number(n))));
      setItemIds(new Set<string>(itemKeys || []));
    } catch (e: any) {
      setIds(new Set<number>());
      setItemIds(new Set<string>());
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const isFavorite = useCallback((providerId: number | string) => ids.has(Number(providerId)), [ids]);

  const toggle = useCallback(
    async (providerId: number | string) => {
      const id = Number(providerId);
      const wasFav = ids.has(id);
      setIds((prev) => {
        const next = new Set(prev);
        if (wasFav) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        if (wasFav) await customerApi.removeFavorite(id);
        else await customerApi.addFavorite(id);
        return true;
      } catch (e: any) {
        setIds((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(id);
          else next.delete(id);
          return next;
        });
        return false;
      }
    },
    [ids]
  );

  const isItemFavorite = useCallback((itemType: string, itemId: number | string) => itemIds.has(`${itemType}:${itemId}`), [itemIds]);

  const toggleItem = useCallback(
    async (itemType: string, itemId: number | string) => {
      const key = `${itemType}:${itemId}`;
      const wasFav = itemIds.has(key);
      setItemIds((prev) => {
        const next = new Set(prev);
        if (wasFav) next.delete(key);
        else next.add(key);
        return next;
      });
      try {
        if (wasFav) await customerApi.removeItemFavorite(itemType, itemId);
        else await customerApi.addItemFavorite(itemType, itemId);
        return true;
      } catch (e: any) {
        setItemIds((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(key);
          else next.delete(key);
          return next;
        });
        return false;
      }
    },
    [itemIds]
  );

  return (
    <FavoritesContext.Provider value={{ ids, isFavorite, toggle, isItemFavorite, toggleItem, refresh: load }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}
