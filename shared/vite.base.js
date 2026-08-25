import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { sharedCspPlugin } from './vite-plugin-csp.js';

const sharedSrc = (p) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// إعداد Vite موحّد لكل لوحات المنصة. كل لوحة تستدعي createViteConfig مع منفذها فقط،
// فتُزال أربع نسخ متطابقة من الاسماء المستعارة (alias) وإعدادات الـCSP.
export function createViteConfig({ port }) {
  return defineConfig({
    plugins: [react(), sharedCspPlugin()],
    resolve: {
      alias: [
        { find: '@rafidain/shared/styles.css', replacement: sharedSrc('styles.css') },
        { find: '@rafidain/shared/api', replacement: sharedSrc('api.ts') },
        { find: '@rafidain/shared/push', replacement: sharedSrc('push.ts') },
        { find: '@rafidain/shared/auth', replacement: sharedSrc('auth.tsx') },
        { find: '@rafidain/shared/ui', replacement: sharedSrc('ui.tsx') },
        { find: '@rafidain/shared/default-api', replacement: sharedSrc('default-api.ts') },
        { find: '@rafidain/shared/default-push', replacement: sharedSrc('default-push.ts') },
        { find: '@rafidain/shared', replacement: sharedSrc('index.ts') },
      ],
    },
    server: {
      port,
      proxy: {
        '/api': 'http://localhost:4001',
      },
    },
  });
}
