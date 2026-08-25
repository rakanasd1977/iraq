#!/usr/bin/env node
// بناء كل الواجهات الأربع + تشغيل اختبارات الخادم — للاستخدام المحلي وفي CI.
// الاستخدام: node scripts/build-all.mjs [--skip-test]
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipTest = process.argv.includes('--skip-test');
const apps = ['customer-mobile', 'admin-panel', 'provider-panel', 'agent-panel'];

function run(cmd, cwd) {
  console.log(`\n▶ ${cmd}  (${path.relative(root, cwd)})`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

for (const app of apps) {
  run('npm install', path.join(root, app));
  run('npm run build', path.join(root, app));
}

if (!skipTest) {
  run('npm install', path.join(root, 'server'));
  run('npm test', path.join(root, 'server'));
}

console.log('\n✅ build-all: كل الواجهات بُنيت والاختبارات ناجحة');
