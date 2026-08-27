// إلغاء تسجيل أي Service Worker عالق (مثلاً من نسخة أخرى على نفس المنفذ) يمنع تحميل اللوحة.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) r.unregister().catch(() => {});
    }).catch(() => {});
  });
}

export { ApiError, createApiClient } from './api';
export { createPush, pushSupported, urlBase64ToUint8Array } from './push';
export { createAuth } from './auth';
export { getLocale, setLocale } from './i18n';
export {
  ToastProvider,
  useToast,
  fmt,
  fmtDate,
  ORDER_STATUS,
  LEASE_STATUS,
  Badge,
  Spinner,
  PageLoading,
  EmptyState,
  Confirm,
  Modal,
  Field,
  Toggle,
  StatCard,
  Pagination,
} from './ui';
export { useStaticLists } from './lists';
