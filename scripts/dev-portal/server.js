#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HyperDX Dev Portal — Centralized dashboard for all local environments
// ---------------------------------------------------------------------------
// Discovers running environments by:
//   1. Querying Docker for containers belonging to known Compose projects:
//      - Dev stacks      (project: hdx-dev-<slot>)
//      - E2E test stacks (project: e2e-<slot>)
//      - CI int stacks   (project: int-<slot>)
//   2. Reading slot files from ~/.config/hyperdx/dev-slots/*.json
//      (for non-Docker local dev services like API, App, alerts)
//
// Usage:
//   node scripts/dev-portal/server.js          # default port 9900
//   HDX_PORTAL_PORT=9901 node scripts/dev-portal/server.js
//
// Zero external dependencies — uses only Node.js built-ins.
// ---------------------------------------------------------------------------

const http = require('node:http');
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const url = require('node:url');

const PORT = parseInt(process.env.HDX_PORTAL_PORT || '9900', 10);
const SLOTS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.config',
  'hyperdx',
  'dev-slots',
);

// ---------------------------------------------------------------------------
// Docker discovery
// ---------------------------------------------------------------------------
// Recognised Docker Compose project prefixes and their environment type.
// Dev containers also carry hdx.dev.* labels; E2E and CI containers only
// carry the standard com.docker.compose.* labels.
const PROJECT_PREFIX_TO_ENV = {
  'hdx-dev-': 'dev',
  'e2e-': 'e2e',
  'int-': 'int',
};

function discoverDockerContainers() {
  try {
    // Fetch ALL running containers — we filter by project prefix in JS so
    // that a single `docker ps` call covers dev, E2E and CI environments.
    const raw = execSync('docker ps --format "{{json .}}"', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(c => {
        // Keep only containers whose project matches a known prefix
        const labels = parseContainerLabels(c);
        const project = labels['com.docker.compose.project'] || '';
        return Object.keys(PROJECT_PREFIX_TO_ENV).some(prefix =>
          project.startsWith(prefix),
        );
      });
  } catch {
    return [];
  }
}

function parseContainerLabels(container) {
  // Docker --format "{{json .}}" gives us Labels as a comma-separated string
  const labels = {};
  const labelsStr = container.Labels || '';
  // Labels look like: "hdx.dev.slot=89,hdx.dev.service=clickhouse,com.docker.compose.service=ch-server,..."
  labelsStr.split(',').forEach(pair => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      labels[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
    }
  });
  return labels;
}

function parsePortMappings(portsStr) {
  // Ports look like: "0.0.0.0:30589->8123/tcp, 0.0.0.0:30689->9000/tcp"
  const mappings = [];
  if (!portsStr) return mappings;
  const parts = portsStr.split(',').map(s => s.trim());
  for (const part of parts) {
    const match = part.match(/(?:[\d.]+:)?(\d+)->(\d+)\/(\w+)/);
    if (match) {
      mappings.push({
        hostPort: parseInt(match[1], 10),
        containerPort: parseInt(match[2], 10),
        protocol: match[3],
      });
    }
  }
  return mappings;
}

// ---------------------------------------------------------------------------
// Slot file discovery (for API/App local processes)
// ---------------------------------------------------------------------------
function discoverSlotFiles() {
  const slots = {};
  try {
    if (!fs.existsSync(SLOTS_DIR)) return slots;
    const files = fs.readdirSync(SLOTS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(SLOTS_DIR, file), 'utf-8');
        const data = JSON.parse(content);
        if (data.slot !== undefined) {
          // Check if the PID is still alive
          if (data.pid) {
            try {
              process.kill(data.pid, 0); // signal 0 = check existence
              data.processAlive = true;
            } catch {
              data.processAlive = false;
            }
          }
          slots[data.slot] = data;
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // slots dir doesn't exist yet
  }
  return slots;
}

// ---------------------------------------------------------------------------
// TCP port probe (check if a port is listening)
// ---------------------------------------------------------------------------
function probePort(port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// Derive environment type and slot from a Docker Compose project name
// ---------------------------------------------------------------------------
function parseProject(projectName) {
  for (const [prefix, envType] of Object.entries(PROJECT_PREFIX_TO_ENV)) {
    if (projectName.startsWith(prefix)) {
      const slot = projectName.slice(prefix.length);
      return { envType, slot };
    }
  }
  return null;
}

// Canonical service name from a compose service name.
// Dev containers carry hdx.dev.service; E2E/CI containers only have the
// compose service name (ch-server, db, otel-collector, …).
const COMPOSE_SERVICE_ALIASES = {
  'ch-server': 'clickhouse',
  db: 'mongodb',
};

function canonicalServiceName(labels) {
  if (labels['hdx.dev.service']) return labels['hdx.dev.service'];
  const composeName = labels['com.docker.compose.service'] || '';
  return COMPOSE_SERVICE_ALIASES[composeName] || composeName;
}

// Resolve the git repository root for a directory. Returns the absolute path
// or null if not inside a git repo.  Results are cached in gitRootCache.
const gitRootCache = new Map();
function resolveGitRoot(dir) {
  if (!dir) return null;
  if (gitRootCache.has(dir)) return gitRootCache.get(dir);
  let root = null;
  try {
    root =
      execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        timeout: 3000,
        cwd: dir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
  } catch {
    // not a git repo
  }
  gitRootCache.set(dir, root);
  return root;
}

// Resolve git branch for a working directory. Cached per request cycle via
// the branchCache map passed in from the caller.
function resolveGitBranch(workingDir, branchCache) {
  if (!workingDir) return 'unknown';
  if (branchCache.has(workingDir)) return branchCache.get(workingDir);
  let branch = 'unknown';
  try {
    branch =
      execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        timeout: 3000,
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || 'unknown';
  } catch {
    // not a git repo or git not available
  }
  branchCache.set(workingDir, branch);
  return branch;
}

// ---------------------------------------------------------------------------
// Aggregate all data into a unified view
// ---------------------------------------------------------------------------
async function buildDashboardData() {
  const containers = discoverDockerContainers();
  const slotFiles = discoverSlotFiles();

  // Group Docker containers by a unique key: `${envType}-${slot}`
  const stackMap = {};
  const branchCache = new Map();

  function ensureStack(key, slot, envType) {
    if (!stackMap[key]) {
      stackMap[key] = {
        slot: parseInt(slot, 10),
        envType,
        branch: 'unknown',
        worktree: 'unknown',
        worktreePath: '',
        services: [],
      };
    }
    return stackMap[key];
  }

  for (const container of containers) {
    const labels = parseContainerLabels(container);
    const project = labels['com.docker.compose.project'] || '';
    const parsed = parseProject(project);
    if (!parsed) continue;

    const { envType, slot } = parsed;
    const key = `${envType}-${slot}`;
    const stack = ensureStack(key, slot, envType);

    // Dev containers carry hdx.dev.* labels with branch/worktree info.
    // E2E and CI containers only have standard compose labels, so we
    // derive worktree from the working_dir and resolve the git branch.
    if (envType === 'dev') {
      if (labels['hdx.dev.branch']) stack.branch = labels['hdx.dev.branch'];
      if (labels['hdx.dev.worktree'])
        stack.worktree = labels['hdx.dev.worktree'];
    }

    // For all envTypes: fall back to compose working_dir when missing.
    // The working_dir may be a subdirectory (e.g. packages/app/tests/e2e
    // for E2E containers), so resolve up to the git repo root.
    const workingDir = labels['com.docker.compose.project.working_dir'] || '';
    if (workingDir && stack.worktree === 'unknown') {
      const repoRoot = resolveGitRoot(workingDir) || workingDir;
      stack.worktree = path.basename(repoRoot);
      stack.worktreePath = repoRoot;
    }
    if (workingDir && stack.branch === 'unknown') {
      stack.branch = resolveGitBranch(workingDir, branchCache);
    }

    const ports = parsePortMappings(container.Ports);
    const mainPort = labels['hdx.dev.port']
      ? parseInt(labels['hdx.dev.port'], 10)
      : ports.length > 0
        ? ports[0].hostPort
        : null;

    stack.services.push({
      name: canonicalServiceName(labels),
      type: 'docker',
      status: container.State === 'running' ? 'up' : 'down',
      port: mainPort,
      url: labels['hdx.dev.url'] || null,
      ports,
      containerId: container.ID,
      uptime: container.RunningFor || '',
    });
  }

  // Merge slot file data (API/App local processes) — only applies to dev stacks
  for (const [slotStr, data] of Object.entries(slotFiles)) {
    const slot = slotStr.toString();
    const key = `dev-${slot}`;
    const stack = ensureStack(key, slot, 'dev');

    // Enrich with branch/worktree from slot file if Docker labels are generic
    if (stack.branch === 'unknown' && data.branch) {
      stack.branch = data.branch;
    }
    if (stack.worktree === 'unknown' && data.worktree) {
      stack.worktree = data.worktree;
    }
    stack.worktreePath = data.worktreePath || '';

    // Add API and App as services (probe their ports)
    const apiUp = await probePort(data.apiPort);
    const appUp = await probePort(data.appPort);

    // Only add if not already present from Docker
    const hasApi = stack.services.some(s => s.name === 'api');
    const hasApp = stack.services.some(s => s.name === 'app');

    if (!hasApi) {
      stack.services.unshift({
        name: 'api',
        type: 'local',
        status: apiUp ? 'up' : 'down',
        port: data.apiPort,
        url: `http://localhost:${data.apiPort}`,
        ports: [],
        uptime: data.startedAt || '',
      });
    }

    if (!hasApp) {
      stack.services.unshift({
        name: 'app',
        type: 'local',
        status: appUp ? 'up' : 'down',
        port: data.appPort,
        url: `http://localhost:${data.appPort}`,
        ports: [],
        uptime: data.startedAt || '',
      });
    }

    // Add alerts and common-utils as local services (detected by log file existence)
    const logsDir = data.logsDir || path.join(SLOTS_DIR, String(slot), 'logs');
    const localOnlyServices = [
      { name: 'alerts', logFile: 'alerts.log' },
      { name: 'common-utils', logFile: 'common-utils.log' },
    ];
    for (const { name, logFile } of localOnlyServices) {
      if (!stack.services.some(s => s.name === name)) {
        const logExists = fs.existsSync(path.join(logsDir, logFile));
        stack.services.push({
          name,
          type: 'local',
          status: logExists ? 'up' : 'down',
          port: null,
          url: null,
          ports: [],
          uptime: data.startedAt || '',
        });
      }
    }
  }

  // Probe known local service ports for E2E and CI stacks.
  // These are processes started by Playwright (E2E) or the Makefile (CI),
  // not Docker containers, so they don't appear in the container list.
  const ENV_LOCAL_SERVICES = {
    e2e: [
      { name: 'e2e-runner', basePort: null }, // meta-service, detected by log file
      { name: 'api', basePort: 21000 },
      { name: 'app', basePort: 21300 },
    ],
    int: [{ name: 'api', basePort: 19000 }],
  };

  for (const stack of Object.values(stackMap)) {
    const localServices = ENV_LOCAL_SERVICES[stack.envType];
    if (!localServices) continue;

    for (const { name, basePort } of localServices) {
      if (stack.services.some(s => s.name === name)) continue;

      if (basePort) {
        const port = basePort + stack.slot;
        const up = await probePort(port);
        stack.services.unshift({
          name,
          type: 'local',
          status: up ? 'up' : 'down',
          port,
          url: `http://localhost:${port}`,
          ports: [],
          uptime: '',
        });
      } else {
        // Meta-service (e.g. e2e-runner) — detect by log file existence
        const logsDir = path.join(
          SLOTS_DIR,
          String(stack.slot),
          `logs-${stack.envType}`,
        );
        const logFile = ENV_LOG_FILES[stack.envType]?.[name];
        const logExists = logFile && fs.existsSync(path.join(logsDir, logFile));
        stack.services.unshift({
          name,
          type: 'local',
          status: logExists ? 'up' : 'down',
          port: null,
          url: null,
          ports: [],
          uptime: '',
        });
      }
    }
  }

  // Sort: dev stacks first, then e2e, then int. Within each type sort by slot.
  const envOrder = { dev: 0, e2e: 1, int: 2 };
  const serviceOrder = [
    'e2e-runner',
    'app',
    'api',
    'alerts',
    'common-utils',
    'clickhouse',
    'mongodb',
    'otel-collector',
    'otel-collector-json',
  ];

  return Object.values(stackMap)
    .sort((a, b) => {
      const ea = envOrder[a.envType] ?? 9;
      const eb = envOrder[b.envType] ?? 9;
      return ea !== eb ? ea - eb : a.slot - b.slot;
    })
    .map(stack => ({
      ...stack,
      services: stack.services.sort((a, b) => {
        const ai = serviceOrder.indexOf(a.name);
        const bi = serviceOrder.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    }));
}

// ---------------------------------------------------------------------------
// Log retrieval
// ---------------------------------------------------------------------------

// Map service names to log file names, keyed by envType.
// dev:  each service has its own log file in <slot>/logs/
// e2e:  single e2e.log captures the full Playwright run in <slot>/logs-e2e/
// int:  api-int.log / common-utils-int.log / ci-int.log in <slot>/logs-int/
const ENV_LOG_FILES = {
  dev: {
    api: 'api.log',
    app: 'app.log',
    alerts: 'alerts.log',
    'common-utils': 'common-utils.log',
  },
  e2e: {
    'e2e-runner': 'e2e.log',
    api: 'e2e.log', // API output is captured inside the Playwright log
    app: 'e2e.log', // App output is captured inside the Playwright log
  },
  int: {
    api: 'api-int.log',
    'common-utils': 'common-utils-int.log',
  },
};

// Backwards-compatible alias used only by dev stacks
const LOCAL_LOG_FILES = ENV_LOG_FILES.dev;

// Log subdirectory per envType
const ENV_LOG_DIRS = {
  dev: 'logs',
  e2e: 'logs-e2e',
  int: 'logs-int',
};

// Map canonical service names to Docker Compose service names
const DOCKER_SERVICE_NAMES = {
  clickhouse: 'ch-server',
  mongodb: 'db',
  'otel-collector': 'otel-collector',
  'otel-collector-json': 'otel-collector-json',
};

// Map envType -> { project prefix, compose file relative to repo root }
const ENV_COMPOSE_CONFIG = {
  dev: { prefix: 'hdx-dev-', composeFile: 'docker-compose.dev.yml' },
  e2e: {
    prefix: 'e2e-',
    composeFile: 'packages/app/tests/e2e/docker-compose.yml',
  },
  int: { prefix: 'int-', composeFile: 'docker-compose.ci.yml' },
};

function getLocalLogs(slot, service, tail, envType = 'dev') {
  const logFiles = ENV_LOG_FILES[envType] || ENV_LOG_FILES.dev;
  const logFile = logFiles[service];
  if (!logFile) return null;

  const logSubdir = ENV_LOG_DIRS[envType] || 'logs';
  const logPath = path.join(SLOTS_DIR, String(slot), logSubdir, logFile);
  try {
    if (!fs.existsSync(logPath)) return null;
    const content = fs.readFileSync(logPath, 'utf-8');
    if (tail > 0) {
      const lines = content.split('\n');
      return lines.slice(-tail).join('\n');
    }
    return content;
  } catch {
    return null;
  }
}

function getDockerLogs(slot, service, tail, envType = 'dev') {
  const composeService = DOCKER_SERVICE_NAMES[service];
  if (!composeService) return null;

  const config = ENV_COMPOSE_CONFIG[envType] || ENV_COMPOSE_CONFIG.dev;
  const project = `${config.prefix}${slot}`;
  try {
    const logs = execSync(
      `docker compose -p "${project}" -f "${config.composeFile}" logs --no-color --tail ${tail} "${composeService}"`,
      { encoding: 'utf-8', timeout: 5000, cwd: process.cwd() },
    );
    return logs;
  } catch {
    // Fallback: find container by project + compose service and use docker logs
    try {
      const containerId = execSync(
        `docker ps -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.service=${composeService}"`,
        { encoding: 'utf-8', timeout: 3000 },
      ).trim();
      if (!containerId) return null;
      return execSync(`docker logs --tail ${tail} "${containerId}"`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      return null;
    }
  }
}

function getLogs(slot, service, tail = 100, envType = 'dev') {
  // Try local log file first (all env types may have log files now)
  const local = getLocalLogs(slot, service, tail, envType);
  if (local !== null) return local;
  return getDockerLogs(slot, service, tail, envType) || '';
}

/**
 * Stream logs via Server-Sent Events (SSE).
 * For Docker: spawns `docker logs --follow`.
 * For local: tails the log file with periodic polling.
 */
function streamLogs(slot, service, req, res, envType = 'dev') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = data => {
    // SSE format: each line of data prefixed with "data: "
    const lines = data.split('\n');
    for (const line of lines) {
      res.write(`data: ${line}\n`);
    }
    res.write('\n');
  };

  // Try Docker streaming first
  const composeService = DOCKER_SERVICE_NAMES[service];
  if (composeService) {
    const config = ENV_COMPOSE_CONFIG[envType] || ENV_COMPOSE_CONFIG.dev;
    const project = `${config.prefix}${slot}`;
    const child = spawn(
      'docker',
      [
        'compose',
        '-p',
        project,
        '-f',
        config.composeFile,
        'logs',
        '--no-color',
        '--follow',
        '--tail',
        '50',
        composeService,
      ],
      { cwd: process.cwd() },
    );

    child.stdout.on('data', chunk => sendEvent(chunk.toString()));
    child.stderr.on('data', chunk => sendEvent(chunk.toString()));
    child.on('close', () => {
      res.write('event: close\ndata: stream ended\n\n');
      res.end();
    });

    req.on('close', () => child.kill());
    return;
  }

  // For local services: poll the log file
  const logFiles = ENV_LOG_FILES[envType] || ENV_LOG_FILES.dev;
  const logFile = logFiles[service];
  if (logFile) {
    const logSubdir = ENV_LOG_DIRS[envType] || 'logs';
    const logPath = path.join(SLOTS_DIR, String(slot), logSubdir, logFile);
    let lastSize = 0;

    // Send initial tail
    try {
      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        // Read last 8KB for initial payload
        const readStart = Math.max(0, stat.size - 8192);
        const fd = fs.openSync(logPath, 'r');
        const buf = Buffer.alloc(stat.size - readStart);
        fs.readSync(fd, buf, 0, buf.length, readStart);
        fs.closeSync(fd);
        sendEvent(buf.toString('utf-8'));
        lastSize = stat.size;
      }
    } catch {
      // file may not exist yet
    }

    // Poll for new content
    const interval = setInterval(() => {
      try {
        if (!fs.existsSync(logPath)) return;
        const stat = fs.statSync(logPath);
        if (stat.size > lastSize) {
          const fd = fs.openSync(logPath, 'r');
          const buf = Buffer.alloc(stat.size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          sendEvent(buf.toString('utf-8'));
          lastSize = stat.size;
        }
      } catch {
        // ignore read errors
      }
    }, 1000);

    req.on('close', () => clearInterval(interval));
    return;
  }

  // Unknown service
  sendEvent('Unknown service: ' + service);
  res.end();
}

// ---------------------------------------------------------------------------
// Log history — archived runs stored in <slot>/history/<envType>-<ISO ts>/
// ---------------------------------------------------------------------------
const HISTORY_DIR_RE = /^(dev|e2e|int)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

function discoverHistory() {
  const results = [];
  try {
    if (!fs.existsSync(SLOTS_DIR)) return results;

    // Compute this portal's own slot so we know when process.cwd() is a
    // valid fallback (only for the slot that matches this worktree).
    let localSlot = null;
    try {
      const cwd = process.cwd();
      const base = path.basename(cwd);
      const cksum = [...base].reduce((s, c) => s + c.charCodeAt(0), 0);
      localSlot = cksum % 100;
    } catch {
      // ignore
    }

    for (const slotEntry of fs.readdirSync(SLOTS_DIR)) {
      const histDir = path.join(SLOTS_DIR, slotEntry, 'history');
      if (!fs.existsSync(histDir) || !fs.statSync(histDir).isDirectory())
        continue;

      const slot = parseInt(slotEntry, 10);
      if (isNaN(slot)) continue;

      // Resolve slot-level worktree/branch from the JSON file (if still alive)
      let slotWorktree = null;
      let slotBranch = null;
      const slotFile = path.join(SLOTS_DIR, `${slot}.json`);
      try {
        if (fs.existsSync(slotFile)) {
          const data = JSON.parse(fs.readFileSync(slotFile, 'utf-8'));
          slotWorktree = data.worktree || null;
          slotBranch = data.branch || null;
          if (!slotWorktree && data.worktreePath) {
            slotWorktree = path.basename(data.worktreePath);
          }
        }
      } catch {
        // ignore
      }

      // Collect entries for this slot, reading meta.json where available
      const slotEntries = [];
      let metaWorktree = null;
      let metaBranch = null;

      for (const runDir of fs.readdirSync(histDir)) {
        const match = runDir.match(HISTORY_DIR_RE);
        if (!match) continue;

        const runPath = path.join(histDir, runDir);
        if (!fs.statSync(runPath).isDirectory()) continue;

        const files = fs.readdirSync(runPath).filter(f => f.endsWith('.log'));
        if (files.length === 0) continue;

        let totalSize = 0;
        for (const f of files) {
          try {
            totalSize += fs.statSync(path.join(runPath, f)).size;
          } catch {
            // ignore
          }
        }

        // Read per-run meta.json
        let runWorktree = null;
        let runBranch = null;
        const metaPath = path.join(runPath, 'meta.json');
        try {
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            runWorktree = meta.worktree || null;
            runBranch = meta.branch || null;
            // Remember the first valid meta as a fallback for siblings
            if (runWorktree && !metaWorktree) {
              metaWorktree = runWorktree;
              metaBranch = runBranch;
            }
          }
        } catch {
          // ignore parse errors
        }

        slotEntries.push({
          slot,
          envType: match[1],
          timestamp: match[2],
          dir: runDir,
          files,
          totalSize,
          worktree: runWorktree,
          branch: runBranch,
        });
      }

      // For entries without meta.json, resolve the worktree using this
      // priority: 1) sibling meta.json, 2) slot JSON file, 3) process.cwd()
      // (only if this is the local slot).
      let fallbackWorktree = metaWorktree || slotWorktree || null;
      let fallbackBranch = metaBranch || slotBranch || null;
      if (!fallbackWorktree && slot === localSlot) {
        const cwd = process.cwd();
        const repoRoot = resolveGitRoot(cwd);
        if (repoRoot) {
          fallbackWorktree = path.basename(repoRoot);
          fallbackBranch = resolveGitBranch(cwd, new Map());
        }
      }

      for (const entry of slotEntries) {
        if (!entry.worktree) {
          entry.worktree = fallbackWorktree || `slot-${slot}`;
        }
        if (!entry.branch) {
          entry.branch = fallbackBranch || 'unknown';
        }
        results.push(entry);
      }
    }
  } catch {
    // slots dir doesn't exist or isn't readable
  }
  // Sort newest first
  results.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  return results;
}

function getHistoryLog(slot, dir, file) {
  // Validate directory name to prevent path traversal
  if (!HISTORY_DIR_RE.test(dir)) return null;
  if (file.includes('/') || file.includes('..')) return null;

  const logPath = path.join(SLOTS_DIR, String(slot), 'history', dir, file);
  try {
    if (!fs.existsSync(logPath)) return null;
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }
}

function deleteHistoryEntry(slot, dir) {
  if (!HISTORY_DIR_RE.test(dir)) return false;
  const dirPath = path.join(SLOTS_DIR, String(slot), 'history', dir);
  try {
    if (!fs.existsSync(dirPath)) return false;
    fs.rmSync(dirPath, { recursive: true, force: true });
    // Clean up empty parent directories
    const histDir = path.join(SLOTS_DIR, String(slot), 'history');
    try {
      if (fs.existsSync(histDir) && fs.readdirSync(histDir).length === 0) {
        fs.rmdirSync(histDir);
      }
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------
function renderDashboardHtml() {
  return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/stacks') {
    const data = await buildDashboardData();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  } else if (pathname.match(/^\/api\/logs\/([a-z][a-z0-9]*)\/(\d+)\/(.+)$/)) {
    // New route: /api/logs/:envType/:slot/:service
    const match = pathname.match(
      /^\/api\/logs\/([a-z][a-z0-9]*)\/(\d+)\/(.+)$/,
    );
    const envType = match[1];
    const slot = match[2];
    const service = decodeURIComponent(match[3]);
    const tail = parseInt(parsed.query.tail || '200', 10);

    if (parsed.query.stream === '1') {
      streamLogs(slot, service, req, res, envType);
    } else {
      const logs = getLogs(slot, service, tail, envType);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(logs);
    }
  } else if (pathname.match(/^\/api\/logs\/(\d+)\/(.+)$/)) {
    // Legacy route: /api/logs/:slot/:service (assumes dev)
    const match = pathname.match(/^\/api\/logs\/(\d+)\/(.+)$/);
    const slot = match[1];
    const service = decodeURIComponent(match[2]);
    const tail = parseInt(parsed.query.tail || '200', 10);

    if (parsed.query.stream === '1') {
      streamLogs(slot, service, req, res, 'dev');
    } else {
      const logs = getLogs(slot, service, tail, 'dev');
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(logs);
    }
  } else if (pathname === '/api/history' && req.method === 'GET') {
    const data = discoverHistory();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  } else if (
    pathname.match(/^\/api\/history\/(\d+)\/([^/]+)\/(.+)$/) &&
    req.method === 'GET'
  ) {
    const match = pathname.match(/^\/api\/history\/(\d+)\/([^/]+)\/(.+)$/);
    const slot = match[1];
    const dir = decodeURIComponent(match[2]);
    const file = decodeURIComponent(match[3]);
    const content = getHistoryLog(slot, dir, file);
    if (content !== null) {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
    } else {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('Not found');
    }
  } else if (
    pathname.match(/^\/api\/history\/(\d+)\/([^/]+)$/) &&
    req.method === 'DELETE'
  ) {
    const match = pathname.match(/^\/api\/history\/(\d+)\/([^/]+)$/);
    const slot = match[1];
    const dir = decodeURIComponent(match[2]);
    const ok = deleteHistoryEntry(slot, dir);
    res.writeHead(ok ? 200 : 404, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ok }));
  } else if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderDashboardHtml());
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  HyperDX Dev Portal running at http://localhost:${PORT}\n`);
  console.log(
    '  Discovering dev stacks via Docker labels + ~/.config/hyperdx/dev-slots/',
  );
  console.log('  Press Ctrl+C to stop\n');
});
