import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { customerApi } from '../api';
import type { FollowContextValue } from '../types';

const FollowContext = createContext<FollowContextValue | null>(null);

export function FollowProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<number>>(() => new Set<number>());

  const load = useCallback(async () => {
    if (!user) {
      setIds(new Set<number>());
      return;
    }
    try {
      const list = await customerApi.followingIds();
      setIds(new Set<number>((list || []).map((n: any) => Number(n))));
    } catch (e: any) {
      setIds(new Set<number>());
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const isFollowing = useCallback((providerId: number | string) => ids.has(Number(providerId)), [ids]);

  const toggle = useCallback(
    async (providerId: number | string) => {
      const id = Number(providerId);
      const was = ids.has(id);
      setIds((prev) => {
        const next = new Set(prev);
        if (was) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        if (was) await customerApi.unfollow(id);
        else await customerApi.follow(id);
        return true;
      } catch (e: any) {
        setIds((prev) => {
          const next = new Set(prev);
          if (was) next.add(id);
          else next.delete(id);
          return next;
        });
        return false;
      }
    },
    [ids]
  );

  return (
    <FollowContext.Provider value={{ ids, isFollowing, toggle, refresh: load }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow(): FollowContextValue {
  const ctx = useContext(FollowContext);
  if (!ctx) throw new Error('useFollow must be used within FollowProvider');
  return ctx;
}
