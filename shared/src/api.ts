import { getLocale } from './i18n';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const CSRF_COOKIE = 'rafidain_csrf';
const SESSION_COOKIE = 'rafidain_session';

export interface RequestExtra {
  idempotencyKey?: string;
  silent?: boolean;
  raw?: boolean;
}

export interface ApiClient {
  request(method: string, path: string, body?: unknown, extra?: RequestExtra): Promise<any>;
  get(path: string, extra?: RequestExtra): Promise<any>;
  post(path: string, body?: unknown, extra?: RequestExtra): Promise<any>;
  put(path: string, body?: unknown, extra?: RequestExtra): Promise<any>;
  patch(path: string, body?: unknown, extra?: RequestExtra): Promise<any>;
  del(path: string, extra?: RequestExtra): Promise<any>;
  api: ApiClient;
}

export function createApiClient({
  unwrap = false,
  onUnauthorized,
  onError,
}: {
  unwrap?: boolean;
  onUnauthorized?: () => void;
  onError?: (err: Error) => void;
} = {}): ApiClient {
  const API = '/api';

  const clearSession = (): void => {
    try {
      document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
      document.cookie = `${SESSION_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    } catch {
      /* تجاهل */
    }
  };

  const reportError = (err: Error): void => {
    if (onError) {
      try {
        onError(err);
      } catch {
        /* تجاهل */
      }
    }
  };

  async function request(
    method: string,
    path: string,
    body?: unknown,
    extra: RequestExtra = {},
  ): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (extra.idempotencyKey) headers['Idempotency-Key'] = extra.idempotencyKey;
    headers['Accept-Language'] = getLocale();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = readCookie(CSRF_COOKIE);
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    let res: Response;
    try {
      res = await fetch(API + path, {
        method,
        headers,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new ApiError('تعذر الاتصال بالخادم', 0);
      if (!extra.silent) reportError(err);
      throw err;
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* استجابة غير JSON */
    }

    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        if (onUnauthorized) {
          onUnauthorized();
        } else if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
      const err = new ApiError((data && data.message) || 'حدث خطأ غير متوقع', res.status);
      if (!extra.silent) reportError(err);
      throw err;
    }
    if (extra.raw) return data;
    return unwrap ? (data ? data.data : null) : data;
  }

  const client: ApiClient = {
    request,
    get: (p, extra) => request('GET', p, undefined, extra),
    post: (p, b, extra) => request('POST', p, b, extra),
    put: (p, b, extra) => request('PUT', p, b, extra),
    patch: (p, b, extra) => request('PATCH', p, b, extra),
    del: (p, extra) => request('DELETE', p, undefined, extra),
  } as ApiClient;
  client.api = client;
  return client;
}
