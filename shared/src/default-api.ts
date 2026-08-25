import { createApiClient } from './api';
import { toast } from './ui';

// عميل API افتراضي للوحات (مسؤول/وكيل/مزوّد): يعرض الأخطاء عبر التوست.
// بديل عن النسخ المتطابقة في كل لوحة. لوحة الزبون تبقي نسختها المخصّصة (unwrap).
export const api = createApiClient({ onError: (e) => toast.error(e.message) });
