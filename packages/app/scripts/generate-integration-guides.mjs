// @ts-check
/**
 * Generates the inline SDK setup guides shown in the integrations drawer.
 *
 * Source of truth: the ClickStack docs MDX in
 * https://github.com/ClickHouse/mintlify-docs-dev/tree/main/clickstack/ingesting-data/sdks
 *
 * For each SDK/framework we pull the `## Getting started` section, take each
 * `###` step's first fenced code block, and write a committed JSON file that the
 * drawer renders. Endpoint / ingestion-key placeholders are kept as-is and
 * substituted with the team's real values at render time.
 *
 * Run it to refresh the guides when the docs change:
 *   yarn generate:integration-guides
 *
 * The block-classification below is a workaround for the docs not having a
 * machine-readable quickstart structure. See the proposal to standardize that
 * upstream: docs/clickstack-docs-quickstart-proposal.md
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_BASE =
  'https://raw.githubusercontent.com/ClickHouse/mintlify-docs-dev/main/clickstack/ingesting-data/sdks';
const DOCS_BASE = 'https://clickhouse.com/docs';

/** Cap so the inline panel stays focused; deeper docs are one click away. */
const MAX_STEPS = 3;

/** Catalog item id -> MDX file name in the docs repo. */
const GUIDE_SOURCES = {
  browser: 'browser',
  nodejs: 'nodejs',
  python: 'python',
  go: 'golang',
  java: 'java',
  ruby: 'ruby',
  elixir: 'elixir',
  deno: 'deno',
  nextjs: 'nextjs',
  nestjs: 'nestjs',
  'react-native': 'react-native',
};

const OUT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'components',
  'Integrations',
  'integrationGuides.generated.json',
);

/** @param {string} md */
function parseFrontmatter(md) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(md);
  if (!match) return { data: {}, body: md };
  /** @type {Record<string, string>} */
  const data = {};
  for (const line of match[1].split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { data, body: match[2] };
}

/** Strip a trailing Mintlify/Docusaurus `{#anchor}` and markdown emphasis. */
function cleanHeading(text) {
  return text
    .replace(/\s*\{#[^}]*\}\s*$/, '')
    .replace(/[`*_]/g, '')
    .trim();
}

/** Install a package / agent. */
const RE_INSTALL =
  /\b(npm i(nstall)?\b|yarn add\b|pnpm add\b|pip install\b|go get\b|bundle add\b|gem install\b|composer require\b|dotnet add\b|cargo add\b|curl\s|wget\s)|def deps do|\{:hyperdx/i;

/** Start / run the instrumented app. */
const RE_RUN =
  /\b(opentelemetry-instrument|deno run|java -jar|npm run|yarn (dev|start)|rails s(erver)?|mix run)\b|python\s+\S*app\.py|node\s+\S*(index|app)/i;

/** Actually carries the endpoint / ingestion key (best "connect" candidate). */
const RE_ENDPOINT_KEY =
  /OTEL_EXPORTER_OTLP_ENDPOINT|HYPERDX_API_KEY|YOUR_INGESTION|api[_-]?key|:4318/i;

/** Otherwise wires the SDK to the collector (init / logger setup). */
const RE_CONN =
  /\.init\(|HyperDXRum|configure_opentelemetry|OpenTelemetry::SDK\.configure|OpenTelemetryHandler|forRoot|createLogger|log\.setup/i;

const isConnect = code => RE_ENDPOINT_KEY.test(code) || RE_CONN.test(code);

/**
 * Collect every fenced code block inside the first top-level `##` section.
 * @param {string} body
 * @returns {{ lang: string, code: string }[]}
 */
function collectCodeBlocks(body) {
  const lines = body.split('\n');
  const start = lines.findIndex(l => /^##\s/.test(l) && !/^###/.test(l));
  if (start === -1) return [];

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const blocks = [];
  let inFence = false;
  let lang = '';
  /** @type {string[]} */
  let buf = [];
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (inFence) {
      if (/^```/.test(line)) {
        inFence = false;
        const code = buf.join('\n').trimEnd();
        if (code.trim()) blocks.push({ lang, code });
        buf = [];
      } else {
        buf.push(line);
      }
      continue;
    }
    const open = /^```(\S+)?/.exec(line);
    if (open) {
      inFence = true;
      lang = (open[1] || 'text').toLowerCase();
      buf = [];
    }
  }
  return blocks;
}

/**
 * Impose a consistent "Install → Connect → Run" quickstart by classifying the
 * code blocks by content, rather than trusting the (inconsistent) doc headings.
 * Some SDKs configure in code (e.g. `HyperDXRum.init({ url, apiKey })`), others
 * via env vars — both are surfaced as the "Connect" step.
 * @param {string} body
 */
function extractSteps(body) {
  const blocks = collectCodeBlocks(body);
  if (blocks.length === 0) return [];

  const install = blocks.find(b => RE_INSTALL.test(b.code));
  const run = blocks.find(b => b !== install && RE_RUN.test(b.code));
  const others = blocks.filter(b => b !== install && b !== run);
  // Prefer the block that actually carries the endpoint/key, then any init/setup
  // block, then just the first leftover.
  const connect =
    others.find(b => RE_ENDPOINT_KEY.test(b.code)) ||
    others.find(b => RE_CONN.test(b.code)) ||
    others[0];

  /** @type {{ title: string, lang: string, code: string }[]} */
  const steps = [];
  const push = (title, b) => {
    if (b && !steps.some(s => s.code === b.code)) {
      steps.push({ title, lang: b.lang, code: b.code });
    }
  };

  push('Install the SDK', install);
  push(
    connect && isConnect(connect.code) ? 'Connect to ClickStack' : 'Configure',
    connect,
  );
  push('Run your app', run);

  // Make sure even sparse docs render at least two steps, preferring blocks that
  // mention the connection over unrelated usage examples.
  if (steps.length < 2) {
    const rest = [
      ...others.filter(b => isConnect(b.code)),
      ...others.filter(b => !isConnect(b.code)),
    ];
    for (const b of rest) {
      if (steps.length >= 2) break;
      push('Configure', b);
    }
  }

  return steps.slice(0, MAX_STEPS);
}

async function main() {
  /** @type {Record<string, unknown>} */
  const guides = {};

  for (const [id, file] of Object.entries(GUIDE_SOURCES)) {
    const url = `${REPO_BASE}/${file}.mdx`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`! skipping ${id}: ${res.status} ${url}`);
      continue;
    }
    const md = await res.text();
    const { data, body } = parseFrontmatter(md);
    const steps = extractSteps(body);
    if (steps.length === 0) {
      console.warn(`! skipping ${id}: no steps extracted`);
      continue;
    }
    const slug = data.slug || '';
    guides[id] = {
      id,
      title: data.title || id,
      docUrl: slug ? `${DOCS_BASE}${slug}` : '',
      steps,
    };
    console.log(`✓ ${id}: ${steps.length} step(s)`);
  }

  await writeFile(OUT_FILE, `${JSON.stringify(guides, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${Object.keys(guides).length} guides to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
