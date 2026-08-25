import { useState, useEffect } from 'react';

const CACHE_KEY = 'raf_static_lists_v1';
const TTL = 5 * 60 * 1000;

interface CachedStaticLists {
  ts: number;
  governorates?: any[];
  services?: any[];
}

function readCache(): CachedStaticLists | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStaticLists;
    if (!parsed || Date.now() - parsed.ts > TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: { governorates: any[]; services: any[] }): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), ...data }));
  } catch {
    /* تجاهل */
  }
}

export interface StaticLists {
  governorates: any[];
  services: any[];
  loading: boolean;
}

export interface ListsApi {
  get(path: string, extra?: any): Promise<any>;
}

export function useStaticLists(api: ListsApi): StaticLists {
  const [governorates, setGovernorates] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    if (cached) {
      setGovernorates(cached.governorates || []);
      setServices(cached.services || []);
      setLoading(false);
      return;
    }
    Promise.all([api.get('/governorates'), api.get('/services')])
      .then(([g, s]) => {
        if (cancelled) return;
        const gov = g.data || [];
        const svc = s.data || [];
        setGovernorates(gov);
        setServices(svc);
        writeCache({ governorates: gov, services: svc });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { governorates, services, loading };
}
