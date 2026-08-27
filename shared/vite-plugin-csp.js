// سدة Vite مشتركة تضيف سياسة أمان المحتوى (CSP) الصارمة إلى index.html عند البناء فقط.
// التطبيق المُبنى لا يحتوي نصوصاً مضمّنة (خارجية modules فقط) لذا يُسمح بـ 'self' وحده،
// بينما يبقى وضع التطوير (HMR/react-refresh الذي يضخ نصوصاً مضمّنة) بلا CSP حتى لا يُكسر.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

export function sharedCspPlugin() {
  return {
    name: 'rafidain-shared-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
