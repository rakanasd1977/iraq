import { load, save } from './store';
import type { ApiRecord } from './types';

const KEY = 'recent_v1';
const MAX = 12;

export function getRecent(): ApiRecord[] {
  return load(KEY, []);
}

export function trackRecent(entry: ApiRecord): void {
  if (!entry || !entry.id) return;
  const list: ApiRecord[] = load(KEY, []).filter((x: ApiRecord) => !(x.type === entry.type && String(x.id) === String(entry.id)));
  list.unshift(entry);
  save(KEY, list.slice(0, MAX));
}
