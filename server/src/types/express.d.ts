// توسعة أنواع Express للطلب المصادق
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: 'admin' | 'agent' | 'provider' | 'customer';
        email: string;
        name_ar: string;
        agent_id?: number;
        governorate_id?: number;
        agent_commission_rate?: number;
        lease_status?: string;
        lease_expires_at?: string;
        provider_id?: number;
        service_id?: number;
      };
      tokenPayload?: {
        id: number;
        role: string;
        jti?: string;
        twofa_pending?: boolean;
        [key: string]: any;
      };
      provider?: {
        id: number;
        user_id: number;
        governorate_id: number;
        service_id: number;
        name_ar: string;
        name_en: string | null;
        logo: string | null;
        cover: string | null;
        description: string | null;
        address: string | null;
        phone: string | null;
        website: string | null;
        commission_rate: number;
        is_active: number;
        is_featured: number;
        is_verified: number;
        rating: number;
        rating_count: number;
        service_slug: string;
        service_name_ar: string;
        service_icon: string | null;
        governorate_name_ar: string;
        governorate_code: string;
      };
      usedCookieAuth?: boolean;
      permissions?: Record<string, Set<string>>;
      _rbacPerms?: Record<string, Set<string>>;
    }
  }
}

export {};