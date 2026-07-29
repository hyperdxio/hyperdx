// Merge runtime NEXT_PUBLIC_* env vars into the existing __ENV.js written at
// build time by configureRuntimeEnv, so build-time values are preserved and
// runtime values (e.g. docker run -e) take precedence.
const fs = require('fs');

const path = './packages/app/packages/app/public/__ENV.js';

let existing = {};
try {
  const content = fs.readFileSync(path, 'utf8');
  const json = content.replace(/^window\.__ENV\s*=\s*/, '').replace(/;\s*$/, '');
  existing = JSON.parse(json);
} catch {}

const runtime = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith('NEXT_PUBLIC_'))
);

const merged = { ...existing, ...runtime };
fs.writeFileSync(path, 'window.__ENV = ' + JSON.stringify(merged) + ';');
