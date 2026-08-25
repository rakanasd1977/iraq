export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export interface PushApi {
  get(path: string, extra?: any): Promise<any>;
  post(path: string, body?: unknown, extra?: any): Promise<any>;
}

export interface PushOptions {
  api?: PushApi;
  getToken?: () => string | null;
  swUrl?: string;
  unwrap?: boolean;
}

export interface PushManager {
  pushSupported(): boolean;
  urlBase64ToUint8Array(base64String: string): Uint8Array;
  registerSW(): Promise<ServiceWorkerRegistration | null>;
  enablePush(): Promise<boolean>;
  disablePush(): Promise<void>;
}

export function createPush({ api, getToken, swUrl, unwrap = false }: PushOptions = {}): PushManager {
  const SW_PATH = swUrl || '/sw.js';

  async function registerSW(): Promise<ServiceWorkerRegistration | null> {
    if (!pushSupported()) return null;
    try {
      return await navigator.serviceWorker.register(SW_PATH);
    } catch (e) {
      console.warn('[push] فشل تسجيل Service Worker', e);
      return null;
    }
  }

  async function getOrCreateSubscription(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
    if (!api) return null;
    try {
      let sub = await reg.pushManager.getSubscription();
      if (sub) return sub;
      const resp = await api.get('/push/vapid-key');
      const publicKey = unwrap ? (resp && resp.public_key) : (resp && resp.data && resp.data.public_key);
      if (!publicKey) return null;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      return sub;
    } catch (e) {
      console.warn('[push] تعذر الاشتراك', e);
      return null;
    }
  }

  async function enablePush(): Promise<boolean> {
    if (!pushSupported()) return false;
    if (getToken && !getToken()) return false;
    const reg = await registerSW();
    if (!reg) return false;
    const sub = await getOrCreateSubscription(reg);
    if (!sub) return false;
    if (!api) return false;
    try {
      await api.post('/push/subscribe', { endpoint: sub.endpoint, keys: sub.toJSON().keys });
      return true;
    } catch (e) {
      console.warn('[push] تعذر حفظ الاشتراك', e);
      return false;
    }
  }

  async function disablePush(): Promise<void> {
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        if (api) {
          try {
            await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
          } catch {
            /* قد يكون التوكن منتهياً */
          }
        }
        await sub.unsubscribe().catch(() => {});
      }
    } catch (e) {
      console.warn('[push] تعذر الإلغاء', e);
    }
  }

  return { pushSupported, urlBase64ToUint8Array, registerSW, enablePush, disablePush };
}
