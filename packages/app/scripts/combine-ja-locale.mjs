import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const valsDir = path.join(__dirname, 'ja-locale-vals');
const enPath = path.join(appRoot, 'public/locales/en/common.json');
const jaPath = path.join(appRoot, 'public/locales/ja/common.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const keys = Object.keys(en);

const vals = [];
for (let i = 0; i < 7; i++) {
  const p = path.join(valsDir, `${i}.json`);
  const part = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(part)) {
    console.error('Expected array in', p);
    process.exit(1);
  }
  vals.push(...part);
}

if (vals.length !== keys.length) {
  console.error('Expected', keys.length, 'values, got', vals.length);
  process.exit(1);
}

const ja = {};
for (let i = 0; i < keys.length; i++) {
  const v = vals[i];
  if (typeof v !== 'string' || v.length === 0) {
    console.error('Empty or invalid translation at index', i, keys[i]);
    process.exit(1);
  }
  ja[keys[i]] = v;
}

fs.writeFileSync(jaPath, JSON.stringify(ja, null, 2) + '\n', 'utf8');
console.log('Wrote', jaPath, keys.length, 'keys');
