#!/usr/bin/env node
// HDX Eval Run Viewer — tiny stdlib HTTP server.
// Browses runs/ produced by hdx-eval: batches → scenarios → cells → run files,
// serving trajectory + grading JSON to a single-page UI.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const RUNS_DIR = path.resolve(__dirname, '..', '..', 'runs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 5176;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  const buf = Buffer.from(text);
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length });
  res.end(buf);
}

function safeJoin(root, ...parts) {
  const p = path.resolve(root, ...parts);
  if (!p.startsWith(path.resolve(root))) throw new Error('path escapes root');
  return p;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function listBatches() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
}

function isRunJson(f) {
  return /^\d+\.json$/.test(f);
}

function collectRuns(cellDir) {
  let files;
  try {
    files = fs.readdirSync(cellDir);
  } catch {
    return []; // directory may have been removed between discovery and read
  }
  const runIdxs = new Set();
  for (const f of files) {
    const m = /^(\d+)\.json$/.exec(f);
    if (m) runIdxs.add(Number(m[1]));
  }
  return [...runIdxs].sort((a, b) => a - b).map((i) => {
    const grade = readJsonSafe(path.join(cellDir, `${i}.grade.json`));
    const traj = readJsonSafe(path.join(cellDir, `${i}.json`));
    return {
      idx: i,
      combinedScore: grade?.combinedScore ?? null,
      programmaticScore: grade?.programmatic?.score ?? null,
      judgeScore: grade?.judge?.weightedScore ?? null,
      termination: traj?.termination ?? null,
      durationMs: traj?.durationMs ?? null,
      toolCalls: traj?.toolCalls?.length ?? null,
      toolErrors: grade?.toolErrors?.errors ?? null,
    };
  });
}

function listCells(batch) {
  const batchDir = safeJoin(RUNS_DIR, batch);
  if (!fs.existsSync(batchDir)) return null;
  const scenarios = fs
    .readdirSync(batchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const out = [];
  for (const scenario of scenarios) {
    const scenarioDir = path.join(batchDir, scenario);
    const mcps = fs
      .readdirSync(scenarioDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const mcp of mcps) {
      const mcpDir = path.join(scenarioDir, mcp);
      const entries = fs.readdirSync(mcpDir, { withFileTypes: true });

      // Legacy layout: <scenario>/<mcp>/<index>.json
      const hasRunFiles = entries.some((e) => !e.isDirectory() && isRunJson(e.name));
      if (hasRunFiles) {
        const runs = collectRuns(mcpDir);
        if (runs.length > 0) out.push({ scenario, mcp, model: null, runs });
      }

      // Layouts:
      // - <scenario>/<mcp>/<model>/<plugin>/<index>.json (current; the
      //   no-plugin arm lives under <model>/none/)
      // - <scenario>/<mcp>/<model>/<index>.json (legacy, pre-plugin-level)
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const modelDir = path.join(mcpDir, entry.name);
        // Legacy no-plugin arm: runs directly in the model dir.
        const runs = collectRuns(modelDir);
        if (runs.length > 0) out.push({ scenario, mcp, model: entry.name, runs });
        // Plugin arms (incl. `none`): one level deeper. The cell's `model`
        // carries the `<model>/<plugin>` relative path so the run-detail
        // route resolves it.
        let modelEntries = [];
        try {
          modelEntries = fs.readdirSync(modelDir, { withFileTypes: true });
        } catch {
          modelEntries = [];
        }
        for (const pe of modelEntries) {
          if (!pe.isDirectory()) continue;
          const pluginRuns = collectRuns(path.join(modelDir, pe.name));
          if (pluginRuns.length > 0) {
            out.push({
              scenario,
              mcp,
              model: `${entry.name}/${pe.name}`,
              plugin: pe.name,
              runs: pluginRuns,
            });
          }
        }
      }
    }
  }
  return out;
}

const ROUTES = [
  [
    /^\/api\/batches$/,
    (_m, _q, res) => {
      const batches = listBatches().map((name) => {
        const summary = readJsonSafe(path.join(RUNS_DIR, name, '_summary.json'));
        return {
          name,
          generatedAt: summary?.generatedAt ?? null,
          scenarios: summary?.scenarios?.map((s) => s.scenario) ?? null,
        };
      });
      sendJson(res, 200, { batches });
    },
  ],
  [
    /^\/api\/batches\/([^/]+)$/,
    (m, _q, res) => {
      const batch = decodeURIComponent(m[1]);
      const summary = readJsonSafe(safeJoin(RUNS_DIR, batch, '_summary.json'));
      const cells = listCells(batch);
      if (!cells) return sendJson(res, 404, { error: 'batch not found' });
      sendJson(res, 200, { batch, summary, cells });
    },
  ],
  // New layout: /runs/:scenario/:mcp/:model/:idx — `model` may be a nested
  // `<model>/<plugin>` path for plugin arms, so it captures across slashes.
  [
    /^\/api\/batches\/([^/]+)\/runs\/([^/]+)\/([^/]+)\/(.+)\/(\d+)$/,
    (m, _q, res) => {
      const [, batch, scenario, mcp, model, idx] = m.map((x, i) =>
        i === 0 ? x : decodeURIComponent(x),
      );
      const base = safeJoin(RUNS_DIR, batch, scenario, mcp, model);
      const trajectory = readJsonSafe(path.join(base, `${idx}.json`));
      const grade = readJsonSafe(path.join(base, `${idx}.grade.json`));
      if (!trajectory) return sendJson(res, 404, { error: 'run not found' });
      sendJson(res, 200, { trajectory, grade });
    },
  ],
  // Legacy layout: /runs/:scenario/:mcp/:idx (no model segment)
  [
    /^\/api\/batches\/([^/]+)\/runs\/([^/]+)\/([^/]+)\/(\d+)$/,
    (m, _q, res) => {
      const [, batch, scenario, mcp, idx] = m.map((x, i) =>
        i === 0 ? x : decodeURIComponent(x),
      );
      const base = safeJoin(RUNS_DIR, batch, scenario, mcp);
      const trajectory = readJsonSafe(path.join(base, `${idx}.json`));
      const grade = readJsonSafe(path.join(base, `${idx}.grade.json`));
      if (!trajectory) return sendJson(res, 404, { error: 'run not found' });
      sendJson(res, 200, { trajectory, grade });
    },
  ],
];

function handleApi(req, res) {
  const parsed = url.parse(req.url, true);
  for (const [re, fn] of ROUTES) {
    const m = re.exec(parsed.pathname);
    if (m) return fn(m, parsed.query, res);
  }
  sendJson(res, 404, { error: 'not found' });
}

function handleStatic(req, res) {
  let pathname = url.parse(req.url).pathname;
  if (pathname === '/') pathname = '/index.html';
  let filePath;
  try {
    filePath = safeJoin(PUBLIC_DIR, '.' + pathname);
  } catch {
    return sendText(res, 400, 'bad path');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, 'not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  handleStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`hdx-eval viewer: http://localhost:${PORT}`);
  console.log(`  runs dir: ${RUNS_DIR}`);
});
