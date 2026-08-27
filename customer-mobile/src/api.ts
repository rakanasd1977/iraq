import { createApiClient } from '@rafidain/shared/api';
import { toast } from '@rafidain/shared/ui';

const { api, request } = createApiClient({
  unwrap: true,
  onUnauthorized: () => {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.hash = '#/login';
    }
  },
  onError: (e) => toast.error(e.message),
});

export { api, request };

/* تصفح عام (بلا توكن) */
export const publicApi = {
  governorates: () => request('GET', '/public/governorates'),
  governorateByGeo: (lat: number, lng: number) =>
    request('GET', `/public/governorates/by-geo?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`),
  services: (govCode: string) => request('GET', '/public/services' + (govCode ? `?governorate_code=${encodeURIComponent(govCode)}` : '')),
  providers: (params: Record<string, any> = {}, raw = false) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    return request('GET', '/public/providers' + (qs.toString() ? `?${qs.toString()}` : ''), undefined, { raw });
  },
  provider: (id: number | string) => request('GET', `/public/providers/${id}`),
  providerReviews: (id: number | string) => request('GET', `/public/providers/${id}/reviews`),
  itemReviews: (kind: string, itemId: number | string) => request('GET', `/public/items/${kind}/${itemId}/reviews`),
  categories: (id: number | string) => request('GET', `/public/providers/${id}/categories`),
  products: (id: number | string, params: Record<string, any> = {}, raw = false) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    return request('GET', `/public/providers/${id}/products` + (qs.toString() ? `?${qs.toString()}` : ''), undefined, { raw });
  },
  menu: (id: number | string) => request('GET', `/public/providers/${id}/menu`),
  rooms: (id: number | string) => request('GET', `/public/providers/${id}/rooms`),
  flights: (id: number | string) => request('GET', `/public/providers/${id}/flights`),
  packages: (id: number | string) => request('GET', `/public/providers/${id}/packages`),
  promotions: (govCode?: string, placement?: string) => {
    const qs = new URLSearchParams();
    if (govCode) qs.set('governorate_code', govCode);
    if (placement) qs.set('placement', placement);
    const q = qs.toString();
    return request('GET', '/public/promotions' + (q ? `?${q}` : ''));
  },
  promotionClick: (id: number | string, extra: any) => request('POST', `/public/promotions/${id}/click`, undefined, extra),
  deals: (limit = 12, govCode?: string) => request('GET', `/public/deals?limit=${limit}` + (govCode ? `&governorate_code=${encodeURIComponent(govCode)}` : '')),
  topSelling: (govCode?: string, limit = 12) => {
    const qs = new URLSearchParams();
    if (govCode) qs.set('governorate_code', govCode);
    qs.set('limit', String(limit));
    return request('GET', '/public/top-selling?' + qs.toString());
  },
  coupons: () => request('GET', '/public/coupons'),
  config: () => request('GET', '/public/config'),
  homeLayout: () => request('GET', '/public/home-layout'),
};

export const authApi = {
  login: (email: string, password: string, role = 'customer') => request('POST', '/auth/login', { email, password, role }),
  register: (payload: any) => request('POST', '/auth/register-customer', payload),
  verifyEmail: (token: string) => request('POST', '/auth/verify-email', { token }),
  me: () => request('GET', '/auth/me'),
  logout: (extra?: any) => request('POST', '/auth/logout', undefined, extra),
  changePassword: (current_password: string, new_password: string) => request('POST', '/auth/change-password', { current_password, new_password }),
};

export const customerApi = {
  dashboard: () => request('GET', '/customer/dashboard'),
  profile: () => request('GET', '/customer/profile'),
  updateProfile: (p: any) => request('PUT', '/customer/profile', p),
  myOrders: (params: Record<string, any> = {}, raw = false) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    if (!qs.has('limit')) qs.set('limit', '20');
    return request('GET', '/orders' + (qs.toString() ? `?${qs.toString()}` : ''), undefined, { raw });
  },
  order: (id: number | string) => request('GET', `/orders/${id}`),
  createOrder: (body: any, idempotencyKey?: string) => request('POST', '/orders', body, { idempotencyKey }),
  rate: (providerId: number | string, rating: number, comment?: string) => request('POST', `/customer/rate/${providerId}`, { rating, comment }),
  rateInfo: (providerId: number | string) => request('GET', `/customer/rate/${providerId}`),
  itemRateInfo: (kind: string, itemId: number | string) => request('GET', `/customer/rate-item/${kind}/${itemId}`),
  rateItem: (kind: string, itemId: number | string, rating: number, comment?: string) => request('POST', `/customer/rate-item/${kind}/${itemId}`, { rating, comment }),
  favorites: () => request('GET', '/customer/favorites'),
  favoriteIds: () => request('GET', '/customer/favorites/ids'),
  addFavorite: (providerId: number | string) => request('POST', '/customer/favorites', { provider_id: providerId }),
  removeFavorite: (providerId: number | string) => request('DELETE', `/customer/favorites/${providerId}`),
  itemFavoriteKeys: () => request('GET', '/customer/favorites/items-ids'),
  favoritesItems: () => request('GET', '/customer/favorites/items'),
  addItemFavorite: (itemType: string, itemId: number | string) => request('POST', '/customer/favorites/items', { item_type: itemType, item_id: itemId }),
  removeItemFavorite: (itemType: string, itemId: number | string) => request('DELETE', `/customer/favorites/items/${itemType}/${itemId}`),
  following: () => request('GET', '/customer/following'),
  followingIds: () => request('GET', '/customer/following').then((rows: any) => (rows || []).map((r: any) => Number(r.provider_id))),
  follow: (providerId: number | string) => request('POST', '/customer/follow', { provider_id: providerId }),
  unfollow: (providerId: number | string) => request('DELETE', `/customer/follow/${providerId}`),
  addresses: () => request('GET', '/customer/addresses'),
  addAddress: (a: any) => request('POST', '/customer/addresses', a),
  updateAddress: (id: number | string, a: any) => request('PUT', `/customer/addresses/${id}`, a),
  setDefaultAddress: (id: number | string) => request('POST', `/customer/addresses/${id}/default`),
  deleteAddress: (id: number | string) => request('DELETE', `/customer/addresses/${id}`),
  couponPreview: (code: string, amount: number, providerId?: number | string) => {
    const qs = new URLSearchParams({ code, amount: String(amount) });
    if (providerId) qs.set('provider_id', String(providerId));
    return request('GET', `/customer/coupons/preview?${qs.toString()}`);
  },
  loyalty: () => request('GET', '/customer/loyalty'),
  referral: () => request('GET', '/customer/referral'),
};