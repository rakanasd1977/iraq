import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const EXPECTED = 318;

const STALE_TOKENS = ['211/211', '163/163', '250/250', '257/257', '270/270', '277/277', '282/282', '283/283', '284/284', '297/297', '304/304', '307/307', '311/311'];

function fail(msg) {
  console.error('\n❌ ' + msg);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const mdFiles = walk(REPO_ROOT);
let found = 0;

for (const file of mdFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const tok of STALE_TOKENS) {
      if (line.includes(tok)) {
        found++;
        const rel = file.replace(REPO_ROOT + '\\', '');
        console.error(`  • ${rel}:${i + 1} يحتوي على رمز عتيق «${tok}»`);
      }
    }
  });
}

if (found > 0) {
  fail(
    `وُجد ${found} ذكر لعدد اختبارات عتيق. العدد الموحّد حالياً هو ${EXPECTED}/${EXPECTED}.\n` +
     `استبدل أي «211/211» أو «163/163» أو «250/250» أو «257/257» أو «297/297» أو «304/304» أو «307/307» بكلمات (مثل «163 اختباراً») ` +
     `مع الإشارة إلى العدد الحالي 311/311، أو حدّث test-count.json إن كان التغيار مقصوداً.`
  );
}

const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
if (!agents.includes(`${EXPECTED}/${EXPECTED}`)) {
  fail(`ملف AGENTS.md لا يعكس العدد الموحّد (${EXPECTED}/${EXPECTED}). حدّثه.`);
}

console.log(`✔ لا توجد رموز عتيقة للعدد في ${mdFiles.length} ملف توثيق؛ والعدد الموحّد ${EXPECTED}/${EXPECTED} معروف في AGENTS.md.`);
