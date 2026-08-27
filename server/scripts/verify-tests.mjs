import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..');

function fail(msg) {
  console.error('\n❌ ' + msg);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(join(__dirname, 'test-count.json'), 'utf8'));
const expected = Number(cfg.expected);
if (!Number.isInteger(expected) || expected <= 0) {
  fail('قيمة expected في test-count.json غير صالحة: ' + cfg.expected);
}

const testFiles = readdirSync(join(SERVER_ROOT, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(SERVER_ROOT, 'test', f));

if (testFiles.length === 0) fail('لم يُعثر على أي ملف اختبار في server/test');

console.log(`► تشغيل ${testFiles.length} ملف اختبار عبر node --import tsx --test ...`);
const r = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }
);
const out = (r.stdout || '') + (r.stderr || '');

const tests = (out.match(/ℹ\s+tests\s+(\d+)/) || [])[1];
const pass = (out.match(/ℹ\s+pass\s+(\d+)/) || [])[1];
const failCount = (out.match(/ℹ\s+fail\s+(\d+)/) || [])[1];

if (tests === undefined) {
  fail('تعذّر تحليل ملخّص TAP من مخرجات الاختبارات (ربما تحطّم الخادم).');
}

const t = Number(tests);
const f = Number(failCount);

if (f !== 0) {
  fail(`فشل ${f} اختباراً من أصل ${t}. راجع المخرجات أعلاه قبل المتابعة.`);
}

if (t !== expected) {
  fail(
    `عدد الاختبارات الفعلي (${t}) يختلف عن المتوقّع في test-count.json (${expected}).\n` +
    `إن كان التغيير مقصوداً (إضافة/حذف اختبار): عدّل server/scripts/test-count.json وقسم «المخرج» في AGENTS.md ليطابقا ${t}.\n` +
    `إن لم يكن مقصوداً: راجع سبب اختفاء/ظهور اختبارات.`
  );
}

const agentsPath = join(REPO_ROOT, 'AGENTS.md');
const agents = readFileSync(agentsPath, 'utf8');
const marker = `${expected}/${expected}`;
if (!agents.includes(marker)) {
  fail(
    `ملف AGENTS.md لا يعكس العدد الحالي (${marker}). أضف/حدّث الذكر فيه لمنع انحراف التوثيق.\n` +
    `ابحث عن «211/211» أو «163/163» أو أي عدد قديم واستبدله بـ ${marker}.`
  );
}

console.log(`✔ تمّت ${t} اختباراً بنجاح، والعدد موحّد مع test-count.json و AGENTS.md (${marker}).`);
