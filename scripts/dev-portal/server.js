#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HyperDX Dev Portal — Centralized dashboard for multi-worktree dev stacks
// ---------------------------------------------------------------------------
// Discovers running dev environments by:
//   1. Querying Docker for containers with `hdx.dev.slot` labels
//   2. Reading slot files from ~/.config/hyperdx/dev-slots/*.json (for non-Docker services)
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
function discoverDockerContainers() {
  try {
    const raw = execSync(
      'docker ps --filter "label=hdx.dev.slot" --format "{{json .}}"',
      { encoding: 'utf-8', timeout: 5000 },
    );
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
      .filter(Boolean);
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
// Aggregate all data into a unified view
// ---------------------------------------------------------------------------
async function buildDashboardData() {
  const containers = discoverDockerContainers();
  const slotFiles = discoverSlotFiles();

  // Group Docker containers by slot
  const slotMap = {};

  for (const container of containers) {
    const labels = parseContainerLabels(container);
    const slot = labels['hdx.dev.slot'];
    if (slot === undefined) continue;

    if (!slotMap[slot]) {
      slotMap[slot] = {
        slot: parseInt(slot, 10),
        branch: labels['hdx.dev.branch'] || 'unknown',
        worktree: labels['hdx.dev.worktree'] || 'unknown',
        services: [],
      };
    }

    const ports = parsePortMappings(container.Ports);
    const mainPort = labels['hdx.dev.port']
      ? parseInt(labels['hdx.dev.port'], 10)
      : ports.length > 0
        ? ports[0].hostPort
        : null;

    slotMap[slot].services.push({
      name:
        labels['hdx.dev.service'] ||
        labels['com.docker.compose.service'] ||
        container.Names,
      type: 'docker',
      status: container.State === 'running' ? 'up' : 'down',
      port: mainPort,
      url: labels['hdx.dev.url'] || null,
      ports,
      containerId: container.ID,
      uptime: container.RunningFor || '',
    });
  }

  // Merge slot file data (API/App local processes)
  for (const [slotStr, data] of Object.entries(slotFiles)) {
    const slot = slotStr.toString();
    if (!slotMap[slot]) {
      slotMap[slot] = {
        slot: parseInt(slot, 10),
        branch: data.branch || 'unknown',
        worktree: data.worktree || 'unknown',
        services: [],
      };
    }

    // Enrich with branch/worktree from slot file if Docker labels are generic
    if (slotMap[slot].branch === 'unknown' && data.branch) {
      slotMap[slot].branch = data.branch;
    }
    if (slotMap[slot].worktree === 'unknown' && data.worktree) {
      slotMap[slot].worktree = data.worktree;
    }
    slotMap[slot].worktreePath = data.worktreePath || '';

    // Add API and App as services (probe their ports)
    const apiUp = await probePort(data.apiPort);
    const appUp = await probePort(data.appPort);

    // Only add if not already present from Docker
    const hasApi = slotMap[slot].services.some(s => s.name === 'api');
    const hasApp = slotMap[slot].services.some(s => s.name === 'app');

    if (!hasApi) {
      slotMap[slot].services.unshift({
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
      slotMap[slot].services.unshift({
        name: 'app',
        type: 'local',
        status: appUp ? 'up' : 'down',
        port: data.appPort,
        url: `http://localhost:${data.appPort}`,
        ports: [],
        uptime: data.startedAt || '',
      });
    }
  }

  // Sort slots numerically, sort services within each slot
  const serviceOrder = [
    'app',
    'api',
    'clickhouse',
    'mongodb',
    'otel-collector',
    'otel-collector-json',
  ];

  return Object.values(slotMap)
    .sort((a, b) => a.slot - b.slot)
    .map(slot => ({
      ...slot,
      services: slot.services.sort((a, b) => {
        const ai = serviceOrder.indexOf(a.name);
        const bi = serviceOrder.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    }));
}

// ---------------------------------------------------------------------------
// Log retrieval
// ---------------------------------------------------------------------------

// Map service names to log file names for local services
const LOCAL_LOG_FILES = {
  api: 'api.log',
  app: 'app.log',
  alerts: 'alerts.log',
  'common-utils': 'common-utils.log',
};

// Map service names to Docker Compose service names
const DOCKER_SERVICE_NAMES = {
  clickhouse: 'ch-server',
  mongodb: 'db',
  'otel-collector': 'otel-collector',
  'otel-collector-json': 'otel-collector-json',
};

function getLocalLogs(slot, service, tail) {
  const logFile = LOCAL_LOG_FILES[service];
  if (!logFile) return null;

  const logPath = path.join(SLOTS_DIR, String(slot), 'logs', logFile);
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

function getDockerLogs(slot, service, tail) {
  const composeService = DOCKER_SERVICE_NAMES[service];
  if (!composeService) return null;

  const project = `hdx-dev-${slot}`;
  try {
    const logs = execSync(
      `docker compose -p "${project}" -f docker-compose.dev.yml logs --no-color --tail ${tail} "${composeService}"`,
      { encoding: 'utf-8', timeout: 5000, cwd: process.cwd() },
    );
    return logs;
  } catch {
    // Try fallback: find the container by labels and use docker logs directly
    try {
      const containerId = execSync(
        `docker ps -q --filter "label=hdx.dev.slot=${slot}" --filter "label=hdx.dev.service=${service}"`,
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

function getLogs(slot, service, tail = 100) {
  // Try local log file first, then Docker
  const local = getLocalLogs(slot, service, tail);
  if (local !== null) return local;
  return getDockerLogs(slot, service, tail) || '';
}

/**
 * Stream logs via Server-Sent Events (SSE).
 * For Docker: spawns `docker logs --follow`.
 * For local: tails the log file with periodic polling.
 */
function streamLogs(slot, service, req, res) {
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
    const project = `hdx-dev-${slot}`;
    const child = spawn(
      'docker',
      [
        'compose',
        '-p',
        project,
        '-f',
        'docker-compose.dev.yml',
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
  const logFile = LOCAL_LOG_FILES[service];
  if (logFile) {
    const logPath = path.join(SLOTS_DIR, String(slot), 'logs', logFile);
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
  } else if (pathname.match(/^\/api\/logs\/(\d+)\/(.+)$/)) {
    const match = pathname.match(/^\/api\/logs\/(\d+)\/(.+)$/);
    const slot = match[1];
    const service = decodeURIComponent(match[2]);
    const tail = parseInt(parsed.query.tail || '200', 10);

    // Check if client wants SSE streaming
    if (parsed.query.stream === '1') {
      streamLogs(slot, service, req, res);
    } else {
      const logs = getLogs(slot, service, tail);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(logs);
    }
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
