/**
 * Realistic body/attribute generators inspired by the public ClickHouse
 * otel_v2 demo dataset (~68M log rows, ~55% unique bodies). Each helper
 * produces a body string with embedded dynamic values plus an attribute
 * map — the goal is high body cardinality with stable identifiable
 * templates.
 */
import type { SeededRng } from '../rng/seeded';

// ─── Severity ────────────────────────────────────────────────────────────
//
// Real-world OTel collectors aggregate logs from many runtimes and emit
// inconsistent severity strings. Mirror that mess so agents have to handle
// case folding and aliasing.

const SEVERITY_DISTRIBUTION: { value: string; weight: number }[] = [
  { value: 'info', weight: 60 },
  { value: 'INFO', weight: 8 },
  { value: 'information', weight: 8 },
  { value: 'debug', weight: 5 },
  { value: 'DEBUG', weight: 2 },
  { value: 'warn', weight: 8 },
  { value: 'WARN', weight: 1.5 },
  { value: 'warning', weight: 1 },
  { value: 'error', weight: 3 },
  { value: 'ERROR', weight: 1.5 },
  { value: 'fatal', weight: 0.4 },
  { value: 'trace', weight: 1.6 },
];

const SEVERITY_NUMBER_BY_TEXT: Record<string, number> = {
  trace: 1,
  TRACE: 1,
  debug: 5,
  DEBUG: 5,
  info: 9,
  INFO: 9,
  information: 9,
  warn: 13,
  WARN: 13,
  warning: 13,
  error: 17,
  ERROR: 17,
  fatal: 21,
  FATAL: 21,
};

export function pickSeverity(rng: SeededRng): {
  text: string;
  number: number;
} {
  const text = rng.weightedPick(SEVERITY_DISTRIBUTION);
  return { text, number: SEVERITY_NUMBER_BY_TEXT[text] ?? 9 };
}

/**
 * Pick a severity but bias toward a target band ('info'|'warn'|'error').
 * Useful when emitting service-level chatter where the level is determined
 * by the event itself but should still vary case/alias.
 */
export function pickSeverityIn(
  rng: SeededRng,
  band: 'info' | 'debug' | 'warn' | 'error' | 'trace',
): { text: string; number: number } {
  const families: Record<string, { value: string; weight: number }[]> = {
    info: [
      { value: 'info', weight: 70 },
      { value: 'INFO', weight: 15 },
      { value: 'information', weight: 15 },
    ],
    debug: [
      { value: 'debug', weight: 75 },
      { value: 'DEBUG', weight: 25 },
    ],
    warn: [
      { value: 'warn', weight: 70 },
      { value: 'WARN', weight: 15 },
      { value: 'warning', weight: 15 },
    ],
    error: [
      { value: 'error', weight: 70 },
      { value: 'ERROR', weight: 25 },
      { value: 'fatal', weight: 5 },
    ],
    trace: [{ value: 'trace', weight: 100 }],
  };
  const text = rng.weightedPick(families[band]);
  return { text, number: SEVERITY_NUMBER_BY_TEXT[text] ?? 9 };
}

/**
 * Normalize messy OTel severity text (case variants, aliases) into the
 * canonical uppercase form used by ClickHouse schema columns.
 */
export function normalizeSeverityText(
  raw: string,
): 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  const u = raw.toUpperCase();
  if (u.startsWith('WARN')) return 'WARN';
  if (u.startsWith('ERR') || raw === 'fatal') return 'ERROR';
  if (u.startsWith('DEB')) return 'DEBUG';
  if (u === 'TRACE') return 'TRACE';
  return 'INFO';
}

/**
 * Spread `count` timestamps linearly across a time window.
 * `marginMs` is subtracted from the window end to avoid landing exactly
 * on the boundary.
 */
export function spreadTimestamp(
  i: number,
  count: number,
  startMs: number,
  windowMs: number,
  marginMs = 30_000,
): number {
  return count > 1
    ? startMs + (i / (count - 1)) * (windowMs - marginMs)
    : startMs;
}

// ─── Resource attributes (k8s/OTel-style) ────────────────────────────────

const NAMESPACES = [
  'production',
  'staging',
  'platform',
  'observability',
  'edge',
  'data-plane',
];
const NODES = [
  'gke-prod-pool-0a1b',
  'gke-prod-pool-2c3d',
  'gke-prod-pool-4e5f',
  'gke-prod-pool-6g7h',
];
const SERVICE_VERSIONS = ['1.42.3', '1.42.4', '1.43.0', '1.43.1', '2.0.0-rc1'];

export function buildResourceAttrs(args: {
  rng: SeededRng;
  serviceName: string;
  region?: string;
}): Record<string, string> {
  const { rng, serviceName, region } = args;
  const podShortId = rng.hex(5);
  const podHash = rng.hex(8);
  const ns = rng.pick(NAMESPACES);
  const node = rng.pick(NODES);
  return {
    'service.name': serviceName,
    'service.namespace': ns,
    'service.version': rng.pick(SERVICE_VERSIONS),
    'service.instance.id': `${serviceName}-${podHash}-${podShortId}`,
    'k8s.namespace.name': ns,
    'k8s.pod.name': `${serviceName}-${podHash}-${podShortId}`,
    'k8s.pod.uid': uuidv4(rng),
    'k8s.node.name': node,
    'k8s.deployment.name': serviceName,
    'k8s.container.name': serviceName,
    'host.name': node,
    'cloud.region':
      region ?? rng.pick(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1']),
    'telemetry.sdk.name': 'opentelemetry',
    'telemetry.sdk.language': rng.pick([
      'go',
      'java',
      'nodejs',
      'python',
      'rust',
    ]),
    'telemetry.sdk.version': rng.pick(['1.27.0', '1.28.0', '1.29.0']),
    'deployment.environment.name': ns,
  };
}

/**
 * Pre-build a small pool of resource-attribute objects per service so we can
 * sample at row-emit time without paying ~30 attribute-construction lookups
 * per span. Mirrors reality (small fixed set of pods/replicas per service).
 */
export function buildResourcePool(args: {
  rng: SeededRng;
  services: readonly string[];
  instancesPerService?: number;
  region?: string;
}): Record<string, Record<string, string>[]> {
  const { rng, services, region } = args;
  const n = args.instancesPerService ?? 24;
  const out: Record<string, Record<string, string>[]> = {};
  for (const svc of services) {
    out[svc] = [];
    for (let i = 0; i < n; i++) {
      out[svc].push(buildResourceAttrs({ rng, serviceName: svc, region }));
    }
  }
  return out;
}

export function pickResource(
  rng: SeededRng,
  pool: Record<string, Record<string, string>[]>,
  serviceName: string,
): Record<string, string> {
  const list = pool[serviceName];
  if (!list || list.length === 0) {
    return buildResourceAttrs({ rng, serviceName });
  }
  return rng.pick(list);
}

// ─── Body templates ──────────────────────────────────────────────────────

export function uuidv4(rng: SeededRng): string {
  // Deterministic v4-shaped UUID (no real randomness — we use seeded RNG).
  const h = rng.hex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${
    '89ab'[rng.intRange(0, 4)]
  }${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const HTTP_PATHS = [
  '/api/cart',
  '/api/checkout',
  '/api/orders',
  '/api/orders/{id}',
  '/api/products',
  '/api/products/{id}',
  '/api/search',
  '/api/recommendations',
  '/api/users/{id}',
  '/api/inventory/{sku}',
  '/api/health',
  '/api/auth/refresh',
];
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'python-requests/2.32.3',
  'curl/8.6.0',
  'Mozilla/5.0 (compatible; CheckpointBot/1.0)',
];

/** Envoy-style access log body — high cardinality (timestamps, IDs, sizes). */
export function envoyAccessLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
} {
  const { rng, nowMs } = args;
  const ts = new Date(nowMs).toISOString();
  const method = rng.pick(HTTP_METHODS);
  const path = rng.pick(HTTP_PATHS);
  const status = rng.weightedPick([
    { value: 200, weight: 90 },
    { value: 304, weight: 3 },
    { value: 404, weight: 3 },
    { value: 401, weight: 1 },
    { value: 500, weight: 2 },
    { value: 503, weight: 1 },
  ]);
  const reqBytes = rng.intRange(0, 4096);
  const respBytes = rng.intRange(0, 32768);
  const totalMs = rng.intRange(2, 800);
  const upstreamMs = rng.intRange(1, totalMs);
  const reqId = uuidv4(rng);
  const ua = rng.pick(USER_AGENTS);
  const upstreamIp = `10.${rng.intRange(0, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`;
  const sourceIp = `34.${rng.intRange(100, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`;
  const body =
    `[${ts}] "${method} ${path} HTTP/1.1" ${status} - via_upstream - "-" ` +
    `${reqBytes} ${respBytes} ${totalMs} ${upstreamMs} "-" "${ua}" ` +
    `"${reqId}" "frontend-proxy:8080" "${upstreamIp}:80" frontend-proxy ` +
    `${sourceIp}:0 ${upstreamIp}:80 - - default`;
  return {
    body,
    attrs: {
      'event.name': 'proxy.access',
      'http.method': method,
      'url.template': path,
      'url.path': path,
      'url.full': `https://example.com${path}`,
      'http.status_code': String(status),
      'user_agent.original': ua,
      'net.peer_address': upstreamIp,
      'source.address': sourceIp,
      'server.address': 'frontend-proxy',
      'upstream.host': `${upstreamIp}:80`,
      'upstream.cluster': 'default',
      'destination.address': `${upstreamIp}:80`,
      'http.request.body.size': String(reqBytes),
      'http.response.body.size': String(respBytes),
      'http.duration_ms': String(totalMs),
      request_id: reqId,
      'log.iostream': 'stdout',
      'log.file.path': '/var/log/envoy/access.log',
      logtag: 'F',
    },
  };
}

/** logfmt body (popular Go/Python convention). */
function logfmtBody(args: {
  rng: SeededRng;
  nowMs: number;
  level: string;
  msg: string;
  fields: Record<string, string | number | boolean>;
}): string {
  const ts = new Date(args.nowMs).toISOString();
  const parts = [`time="${ts}"`, `level=${args.level}`, `msg="${args.msg}"`];
  for (const [k, v] of Object.entries(args.fields)) {
    if (typeof v === 'string' && /[\s"=]/.test(v)) {
      parts.push(`${k}="${v.replace(/"/g, '\\"')}"`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(' ');
}

const BRANDS = [
  'Nikon',
  'Canon',
  'Sony',
  'Vixen',
  'Bushnell',
  'Orion',
  'Sky-Watcher',
  'Bresser',
  'Leica',
  'Celestron',
  'Meade',
];
const CATEGORIES = [
  'binoculars',
  'telescopes',
  'eyepieces',
  'mounts',
  'tripods',
  'filters',
  'cameras',
  'accessories',
  'books',
  'travel',
  'assembly',
];

/** Product catalog "Product found" log — logfmt with rich attrs. */
export function catalogLog(args: {
  rng: SeededRng;
  nowMs: number;
  level?: string;
}): { body: string; attrs: Record<string, string> } {
  const { rng, nowMs } = args;
  const level = args.level ?? 'info';
  const productId = rng.hex(5).toUpperCase().slice(0, 10);
  const brand = rng.pick(BRANDS);
  const category = rng.pick(CATEGORIES);
  const cacheHit = rng.next() < 0.78;
  const inStock = rng.next() < 0.82;
  const featured = rng.next() < 0.12;
  const onSale = rng.next() < 0.18;
  const price = rng.intRange(2999, 89999);
  const fields = {
    'catalog.product_id': productId,
    'catalog.brand': brand,
    'catalog.cache_hit': cacheHit,
    'catalog.category': category,
    'catalog.in_stock': inStock,
    'catalog.is_featured': featured,
    'catalog.is_on_sale': onSale,
    'catalog.price_cents': price,
    'catalog.lookup_ms': rng.intRange(1, 80),
  };
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level,
      msg: 'Product found',
      fields,
    }),
    attrs: {
      'event.name': 'catalog.lookup',
      'code.function.name': 'GetProduct',
      'code.line.number': String(rng.intRange(40, 320)),
      'code.file.path': '/app/internal/catalog/server.go',
      'product.id': productId,
      'product.brand': brand,
      'product.category': category,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}

/** JSON-event body, common for app-tier services. */
function jsonEventBody(args: {
  rng: SeededRng;
  fields: Record<string, unknown>;
}): string {
  return JSON.stringify(args.fields);
}

const PAGES = [
  '/home',
  '/product',
  '/cart',
  '/checkout',
  '/profile',
  '/orders',
  '/recommendations',
  '/search',
];

/** Frontend page render timing. Keep — it's RUM data. */
export function pageRenderLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
} {
  const { rng, nowMs } = args;
  const path = rng.pick(PAGES);
  const renderMs = rng.intRange(40, 1200);
  const ttfb = rng.intRange(20, renderMs / 2);
  const fcp = rng.intRange(ttfb, renderMs);
  const lcp = rng.intRange(fcp, renderMs);
  const userId = `u${rng.intRange(1, 1_000_000)}`;
  const sessionId = uuidv4(rng);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'info',
      msg: 'page.render',
      fields: {
        path,
        render_ms: renderMs,
        ttfb_ms: ttfb,
        fcp_ms: fcp,
        lcp_ms: lcp,
        user_id: userId,
        session_id: sessionId,
        viewport: rng.pick(['1920x1080', '1366x768', '375x812', '1280x800']),
      },
    }),
    attrs: {
      'event.name': 'page.render',
      'http.route': path,
      'render.ms': String(renderMs),
      'rum.session_id': sessionId,
      'user.id': userId,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}

/** search-service indexing progress. KEEP — operational signal. */
export function indexingLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
} {
  const { rng, nowMs } = args;
  const docs = rng.intRange(1, 5000);
  const shard = rng.intRange(0, 32);
  const lagMs = rng.intRange(50, 1500);
  const seq = rng.intRange(1_000_000, 9_999_999);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'info',
      msg: 'index.shard.flush',
      fields: {
        'search.docs_indexed': docs,
        'search.shard': shard,
        'search.lag_ms': lagMs,
        'search.seq': seq,
        'search.bytes_written': rng.intRange(2048, 524288),
      },
    }),
    attrs: {
      'event.name': 'index.shard.flush',
      'search.shard': String(shard),
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}

const ANALYTICS_EVENTS = [
  'product.view',
  'cart.add',
  'cart.remove',
  'checkout.start',
  'checkout.complete',
  'search.perform',
  'search.click',
  'recommendation.click',
  'page.scroll',
  'video.play',
  'wishlist.add',
];

/** Analytics event log — JSON, KEEP (product signal). */
export function analyticsEventLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
} {
  const { rng, nowMs } = args;
  const event = rng.pick(ANALYTICS_EVENTS);
  const userId = `u${rng.intRange(1, 5_000_000)}`;
  const sessionId = uuidv4(rng);
  const productId = rng.hex(5).toUpperCase().slice(0, 10);
  const fields: Record<string, unknown> = {
    'event.name': event,
    user_id: userId,
    session_id: sessionId,
    timestamp: new Date(nowMs).toISOString(),
    referrer: rng.weightedPick([
      { value: 'organic', weight: 50 },
      { value: 'paid', weight: 20 },
      { value: 'direct', weight: 25 },
      { value: 'email', weight: 5 },
    ]),
    device: rng.pick(['desktop', 'mobile', 'tablet']),
  };
  if (
    event.startsWith('product.') ||
    event.startsWith('cart.') ||
    event === 'checkout.start'
  ) {
    fields.product_id = productId;
    fields.price_cents = rng.intRange(999, 99999);
  }
  if (event === 'search.perform') {
    fields.query = rng.pick([
      'nikon binoculars',
      'celestron telescope',
      'tripod',
      'eyepiece 1.25',
      'star chart',
    ]);
    fields.results_count = rng.intRange(0, 250);
  }
  return {
    body: jsonEventBody({ rng, fields }),
    attrs: {
      'event.name': event,
      'user.id': userId,
      'rum.session_id': sessionId,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}

/** Health check / heartbeat — DROP. High volume but body has dynamic mem/cpu/uptime. */
export function heartbeatLog(args: {
  rng: SeededRng;
  nowMs: number;
  serviceName: string;
}): { body: string; attrs: Record<string, string>; level: string } {
  const { rng, nowMs } = args;
  const uptimeS = rng.intRange(60, 8 * 24 * 3600);
  const cpu = rng.range(0.5, 78).toFixed(2);
  const mem = rng.intRange(128, 4096);
  const queue = rng.intRange(0, 50);
  const inflight = rng.intRange(0, 200);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'debug',
      msg: 'health.check',
      fields: {
        component: 'heartbeat',
        status: 'ok',
        'infra.uptime_sec': uptimeS,
        'infra.cpu_pct': cpu,
        'infra.memory_usage_mb': mem,
        'infra.queue_depth': queue,
        'infra.inflight_requests': inflight,
      },
    }),
    attrs: {
      'event.name': 'health.check',
      'infra.cpu_pct': cpu,
      'infra.memory_usage_mb': String(mem),
      'infra.queue_depth': String(queue),
      'log.iostream': 'stdout',
      logtag: 'F',
      component: 'heartbeat',
    },
    level: 'debug',
  };
}

/** Cache hit chatter — DROP. JSON with high-cardinality keys. */
export function cacheHitLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
  level: string;
} {
  const { rng, nowMs } = args;
  const keyKind = rng.pick([
    'user_profile',
    'session',
    'product',
    'campaign',
    'feature_flag',
    'rate_limit',
    'auth_token',
  ]);
  const keyId = rng.intRange(1, 10_000_000);
  const key = `${keyKind}:${keyId}`;
  const layer = rng.pick(['memcached', 'redis', 'in-memory']);
  const node = rng.pick(['cache-0', 'cache-1', 'cache-2', 'cache-3']);
  const fields = {
    event: 'cache.hit',
    key,
    layer,
    node,
    'cache.ttl_remaining_sec': rng.intRange(1, 86400),
    'cache.value_size_bytes': rng.intRange(8, 65536),
    timestamp: new Date(nowMs).toISOString(),
  };
  return {
    body: jsonEventBody({ rng, fields }),
    attrs: {
      'event.name': 'cache.hit',
      'cache.layer': layer,
      'cache.key': key,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
    level: 'debug',
  };
}

const STACK_FILES = [
  '/app/worker.js',
  '/app/runner.js',
  '/app/lib/retry.js',
  '/app/lib/queue.js',
  '/app/handlers/job.js',
];

/** Recurring caught exception — DROP. Same exception class, varying frames. */
export function caughtExceptionLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
  level: string;
} {
  const { rng, nowMs } = args;
  const cause = rng.pick([
    'transient blip',
    'connection reset',
    'upstream backoff',
    'queue full',
    'rate limited downstream',
    'response timeout',
  ]);
  const frames = Array.from({ length: rng.intRange(3, 6) }, () => {
    const file = rng.pick(STACK_FILES);
    const line = rng.intRange(20, 480);
    const fn = rng.pick([
      'handleJob',
      'run',
      'process',
      'enqueue',
      'flush',
      'tick',
      'consume',
    ]);
    return `    at Worker.${fn} (${file}:${line}:${rng.intRange(2, 80)})`;
  });
  const body = [
    `NonFatalRetryableError: ${cause} (caught)`,
    ...frames,
    `    at processTicksAndRejections (node:internal/process/task_queues:96:5)`,
  ].join('\n');
  return {
    body,
    attrs: {
      'event.name': 'job.caught_exception',
      'error.kind': 'NonFatalRetryableError',
      'error.cause': cause,
      handled: 'true',
      'code.function.name': 'handleJob',
      'log.iostream': 'stderr',
      logtag: 'F',
      // Make this look enough like a real error to fool naive severity-based filters
      // but the cardinality is constrained — agent should recognize the pattern.
      _ts: new Date(nowMs).toISOString(),
    },
    level: 'error',
  };
}

/** Subscription metric-as-log — DROP, convert to gauge metric. */
export function subscriptionMetricLog(args: {
  rng: SeededRng;
  nowMs: number;
}): { body: string; attrs: Record<string, string>; level: string } {
  const { rng, nowMs } = args;
  const tenant = rng.intRange(1, 50_000);
  const mrrCents = rng.intRange(0, 1_000_000);
  const seats = rng.intRange(1, 5000);
  const trialDaysLeft = rng.intRange(0, 30);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'info',
      msg: 'subscription.metric.calculated',
      fields: {
        'tenant.id': tenant,
        'metric.name': 'subscription_mrr',
        'metric.kind': 'gauge',
        mrr_cents: mrrCents,
        seats,
        trial_days_left: trialDaysLeft,
        plan: rng.pick(['starter', 'team', 'business', 'enterprise']),
        currency: 'USD',
      },
    }),
    attrs: {
      'event.name': 'subscription.metric.calculated',
      'metric.name': 'subscription_mrr',
      'metric.kind': 'gauge',
      'tenant.id': String(tenant),
      'log.iostream': 'stdout',
      logtag: 'F',
    },
    level: 'info',
  };
}

const BACKGROUND_BODIES_TEMPLATES = [
  (rng: SeededRng) =>
    `Connection pool stats: idle=${rng.intRange(0, 10)} active=${rng.intRange(0, 30)} waiting=${rng.intRange(0, 5)}`,
  (rng: SeededRng) =>
    `Refunded order ${uuidv4(rng)} amount=${(rng.intRange(100, 99999) / 100).toFixed(2)} reason="${rng.pick(['customer request', 'duplicate charge', 'fraud review', 'pricing error'])}"`,
  (rng: SeededRng) =>
    `Webhook delivered to https://hooks.example.com/${rng.hex(8)} status=${rng.pick([200, 201, 204, 502, 503])} retry=${rng.intRange(0, 3)}`,
  (rng: SeededRng) =>
    `OAuth token refreshed for client_id=${rng.hex(12)} grant_type=refresh_token expires_in=${rng.intRange(300, 7200)}`,
  (rng: SeededRng) =>
    `Slow query detected duration_ms=${rng.intRange(500, 4500)} table=${rng.pick(['orders', 'users', 'invoices', 'sessions'])} rows_scanned=${rng.intRange(10_000, 5_000_000)}`,
  (rng: SeededRng) =>
    `Kafka producer flushed batch_size=${rng.intRange(50, 500)} bytes=${rng.intRange(1024, 1048576)} topic=${rng.pick(['orders', 'audit', 'analytics', 'notifications'])} partition=${rng.intRange(0, 32)}`,
  (rng: SeededRng) =>
    `Migration step completed name="${rng.pick(['add_index_orders_tenant', 'backfill_users_email_lower', 'drop_legacy_sessions'])}" rows_affected=${rng.intRange(0, 10_000_000)} duration_s=${rng.intRange(1, 300)}`,
  (rng: SeededRng) =>
    `CSRF token mismatch on POST /checkout origin=${rng.pick(['https://example.com', 'https://api.example.com', 'null'])} ip=${rng.intRange(1, 254)}.${rng.intRange(0, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`,
  (rng: SeededRng) =>
    `JWT verification failed reason="${rng.pick(['expired', 'invalid signature', 'unknown kid', 'malformed'])}" sub=user-${rng.intRange(1, 999999)}`,
  (rng: SeededRng) =>
    `GDPR deletion request processed user_id=u${rng.intRange(1, 9_999_999)} records_purged=${rng.intRange(0, 50_000)} duration_ms=${rng.intRange(50, 8000)}`,
  (rng: SeededRng) =>
    `Circuit breaker tripped service="${rng.pick(['payment-gateway', 'fraud-detection', 'shipping-api', 'tax-service'])}" failures_in_window=${rng.intRange(5, 200)} cooldown_s=${rng.intRange(15, 300)}`,
  (rng: SeededRng) =>
    `Feature flag evaluated flag="${rng.pick(['new_checkout_flow', 'fast_search', 'price_experiment_b', 'reco_v2'])}" tenant=${rng.intRange(1, 50000)} value=${rng.next() < 0.5 ? 'true' : 'false'}`,
  (rng: SeededRng) =>
    `Health probe response upstream="${rng.pick(['payment-service', 'inventory-service', 'cart-service'])}" code=${rng.pick([200, 200, 200, 503, 504])} latency_ms=${rng.intRange(2, 500)}`,
];

/** Random varied background log. */
export function backgroundLog(args: { rng: SeededRng; nowMs: number }): string {
  const tmpl = args.rng.pick(BACKGROUND_BODIES_TEMPLATES);
  return tmpl(args.rng);
}

// ─── Composite-cell helpers ─────────────────────────────────────────────
//
// These helpers exist so that each (ServiceName, SeverityText) cell can
// contain BOTH a noisy pattern and a legitimate load-bearing pattern at
// comparable volumes. That prevents a `GROUP BY ServiceName, SeverityText`
// agent from cheaply identifying noise without looking at event.name /
// body templates.

/**
 * Push-notification delivery record — KEEP.
 * Lives in `notification-service × DEBUG` next to the cache.hit chatter.
 * Used by support / compliance to confirm whether a user received a push.
 */
export function notificationDeliveryLog(args: {
  rng: SeededRng;
  nowMs: number;
}): { body: string; attrs: Record<string, string>; level: string } {
  const { rng, nowMs } = args;
  const channel = rng.pick(['apns', 'fcm', 'webpush', 'sms']);
  const template = rng.pick([
    'order_shipped',
    'order_delivered',
    'cart_abandoned',
    'price_drop',
    'back_in_stock',
    'security_alert',
    'subscription_expiring',
  ]);
  const userId = `u${rng.intRange(1, 9_000_000)}`;
  const deviceId = uuidv4(rng);
  const messageId = uuidv4(rng);
  const status = rng.weightedPick([
    { value: 'delivered', weight: 88 },
    { value: 'queued', weight: 5 },
    { value: 'throttled', weight: 4 },
    { value: 'unregistered', weight: 3 },
  ]);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'debug',
      msg: 'notification.delivery',
      fields: {
        'notification.channel': channel,
        'notification.template': template,
        'notification.message_id': messageId,
        'notification.status': status,
        'user.id': userId,
        'device.id': deviceId,
        'notification.delivery_ms': rng.intRange(40, 2200),
        'notification.retry_count': rng.intRange(0, 3),
      },
    }),
    attrs: {
      'event.name': 'notification.delivery',
      'notification.channel': channel,
      'notification.status': status,
      'notification.template': template,
      'user.id': userId,
      'message.id': messageId,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
    level: 'debug',
  };
}

/**
 * Billing financial events — KEEP.
 * Lives in `billing-service × INFO` next to the subscription_mrr metric-as-log.
 * These are audit/finance-critical records.
 */
export function billingEventLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
  level: string;
} {
  const { rng, nowMs } = args;
  const event = rng.weightedPick<
    | 'invoice.charged'
    | 'invoice.refunded'
    | 'subscription.activated'
    | 'subscription.cancelled'
    | 'payment.failed'
  >([
    { value: 'invoice.charged', weight: 55 },
    { value: 'invoice.refunded', weight: 8 },
    { value: 'subscription.activated', weight: 18 },
    { value: 'subscription.cancelled', weight: 9 },
    { value: 'payment.failed', weight: 10 },
  ]);
  const tenant = rng.intRange(1, 50_000);
  const invoiceId = `inv_${rng.hex(12)}`;
  const customerId = `cus_${rng.hex(10)}`;
  const amountCents = rng.intRange(500, 999_999);
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'info',
      msg: event,
      fields: {
        'tenant.id': tenant,
        'billing.invoice_id': invoiceId,
        'billing.customer_id': customerId,
        'billing.amount_cents': amountCents,
        'billing.currency': 'USD',
        'billing.processor': rng.pick(['stripe', 'braintree', 'adyen']),
        'billing.payment_method': rng.pick([
          'card',
          'wallet',
          'ach',
          'invoice',
        ]),
      },
    }),
    attrs: {
      'event.name': event,
      'tenant.id': String(tenant),
      'billing.invoice_id': invoiceId,
      'billing.customer_id': customerId,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
    level: 'info',
  };
}

/**
 * Real, unhandled worker failure — KEEP.
 * Lives in `worker × ERROR` next to the NonFatalRetryableError chatter.
 * These are the errors that actually represent jobs that gave up.
 */
export function jobFailedPermanentLog(args: {
  rng: SeededRng;
  nowMs: number;
}): { body: string; attrs: Record<string, string>; level: string } {
  const { rng } = args;
  const jobType = rng.pick([
    'image_resize',
    'email_send',
    'webhook_dispatch',
    'report_export',
    'invoice_generate',
    'data_purge',
  ]);
  const jobId = uuidv4(rng);
  const cause = rng.pick([
    'JobPoisonPillError: input checksum mismatch',
    'JobTimeoutError: exceeded 300s deadline',
    'JobDataLossError: source row deleted mid-flight',
    'JobIntegrityError: foreign key constraint failed after retries',
  ]);
  const attempts = rng.intRange(5, 12);
  const body = [
    `job.failed.permanent type=${jobType} id=${jobId} attempts=${attempts}`,
    `${cause}`,
    `    at Worker.handleJob (/app/worker.js:${rng.intRange(20, 480)}:${rng.intRange(2, 80)})`,
    `    at Worker.process (/app/runner.js:${rng.intRange(20, 480)}:${rng.intRange(2, 80)})`,
  ].join('\n');
  return {
    body,
    attrs: {
      'event.name': 'job.failed.permanent',
      'job.type': jobType,
      'job.id': jobId,
      'job.attempts': String(attempts),
      'error.kind': cause.split(':')[0],
      handled: 'false',
      'log.iostream': 'stderr',
      logtag: 'F',
    },
    level: 'error',
  };
}

/**
 * Per-service operational debug — KEEP.
 * Lives in inventory/pricing/shipping/recommendation × DEBUG next to the
 * health.check heartbeats. Each service emits a distinct event.name.
 */
export function serviceOpsDebugLog(args: {
  rng: SeededRng;
  nowMs: number;
  serviceName:
    | 'inventory-service'
    | 'pricing-service'
    | 'shipping-service'
    | 'recommendation-service';
}): { body: string; attrs: Record<string, string>; level: string } {
  const { rng, nowMs, serviceName } = args;
  let msg: string;
  let extra: Record<string, string | number | boolean>;
  let eventName: string;
  switch (serviceName) {
    case 'inventory-service': {
      eventName = 'inventory.stock_lookup';
      msg = 'inventory.stock_lookup';
      const sku = `sku-${rng.hex(8)}`;
      extra = {
        'inventory.sku': sku,
        'inventory.warehouse': rng.pick(['us-east', 'us-west', 'eu', 'apac']),
        'inventory.on_hand': rng.intRange(0, 1200),
        'inventory.reserved': rng.intRange(0, 300),
        'inventory.lookup_ms': rng.intRange(2, 90),
      };
      break;
    }
    case 'pricing-service': {
      eventName = 'pricing.calculation';
      msg = 'pricing.calculation';
      extra = {
        'pricing.product_id': `prd-${rng.hex(8)}`,
        'pricing.tier': rng.pick(['retail', 'wholesale', 'partner']),
        'pricing.list_cents': rng.intRange(199, 199999),
        'pricing.discount_pct': rng.intRange(0, 60),
        'pricing.tax_jurisdiction': rng.pick(['US-CA', 'US-NY', 'EU-DE', 'JP']),
        'pricing.calc_ms': rng.intRange(1, 35),
      };
      break;
    }
    case 'shipping-service': {
      eventName = 'shipping.rate.quote';
      msg = 'shipping.rate.quote';
      extra = {
        'shipping.origin': rng.pick(['LAX', 'JFK', 'DFW', 'SEA', 'ATL']),
        'shipping.dest_zip': String(rng.intRange(10000, 99999)),
        'shipping.carrier': rng.pick(['ups', 'fedex', 'usps', 'dhl']),
        'shipping.weight_g': rng.intRange(50, 18000),
        'shipping.rate_cents': rng.intRange(299, 4999),
        'shipping.eta_days': rng.intRange(1, 9),
      };
      break;
    }
    case 'recommendation-service': {
      eventName = 'recommendation.score';
      msg = 'recommendation.score';
      extra = {
        'reco.model': rng.pick(['als_v3', 'content_v2', 'hybrid_v1']),
        'reco.user_id': `u${rng.intRange(1, 8_000_000)}`,
        'reco.candidates': rng.intRange(10, 500),
        'reco.returned': rng.intRange(5, 25),
        'reco.score_ms': rng.intRange(8, 220),
      };
      break;
    }
  }
  return {
    body: logfmtBody({ rng, nowMs, level: 'debug', msg, fields: extra }),
    attrs: {
      'event.name': eventName,
      'log.iostream': 'stdout',
      logtag: 'F',
      // Surface the most identifying field as an attribute too so
      // attribute-grouping agents can find this pattern.
      ...Object.fromEntries(
        Object.entries(extra)
          .filter(([, v]) => typeof v !== 'number')
          .map(([k, v]) => [k, String(v)]),
      ),
    },
    level: 'debug',
  };
}

/**
 * Load-balancer health-probe spam — DROP (or filter at the LB layer).
 * Lives in `frontend-proxy × INFO` next to the real Envoy access logs.
 * Looks like an access log to a naive grouping but represents internal
 * `/healthz` traffic that adds noise without diagnostic value.
 */
export function upstreamHealthProbeLog(args: {
  rng: SeededRng;
  nowMs: number;
}): { body: string; attrs: Record<string, string> } {
  const { rng, nowMs } = args;
  const ts = new Date(nowMs).toISOString();
  const probe = rng.pick(['/healthz', '/-/ready', '/healthcheck', '/lb/probe']);
  const upstreamMs = rng.intRange(0, 8);
  const sourceIp = `10.${rng.intRange(0, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`;
  return {
    body:
      `[${ts}] "GET ${probe} HTTP/1.1" 200 - via_upstream - "-" ` +
      `0 4 ${upstreamMs} ${upstreamMs} "-" "kube-probe/1.30" ` +
      `"-" "frontend-proxy:8080" "127.0.0.1:80" frontend-proxy ` +
      `${sourceIp}:0 127.0.0.1:80 - - default`,
    attrs: {
      'event.name': 'lb.health.probe',
      'http.method': 'GET',
      'url.path': probe,
      'http.status_code': '200',
      'user_agent.original': 'kube-probe/1.30',
      'http.duration_ms': String(upstreamMs),
      'source.address': sourceIp,
      'server.address': 'frontend-proxy',
      'lb.probe_kind': probe.replace(/^\//, ''),
      'log.iostream': 'stdout',
      'log.file.path': '/var/log/envoy/access.log',
      logtag: 'F',
    },
  };
}

/**
 * Client-side console.log dumps flushed to the backend — DROP.
 * Lives in `frontend × INFO` next to the page.render RUM logs. Looks like
 * a frontend log but is just chatty debug-style console output never used
 * for anything.
 */
export function consoleLogDumpLog(args: { rng: SeededRng; nowMs: number }): {
  body: string;
  attrs: Record<string, string>;
} {
  const { rng, nowMs } = args;
  const lines = rng.intRange(2, 6);
  const components = ['Cart', 'Header', 'ProductCard', 'Footer', 'Search'];
  const messages = [
    'render',
    'state hydrated',
    'effect ran',
    'memoize hit',
    'prop drilled',
    'click handler attached',
    'noop',
  ];
  const dump: string[] = [];
  for (let i = 0; i < lines; i++) {
    const comp = rng.pick(components);
    const msg = rng.pick(messages);
    dump.push(
      `[console.log] ${comp}.${msg} ts=${nowMs - rng.intRange(0, 300)}`,
    );
  }
  const sessionId = uuidv4(rng);
  return {
    body: `console.log_dump session=${sessionId}\n` + dump.join('\n'),
    attrs: {
      'event.name': 'frontend.console.log_dump',
      'rum.session_id': sessionId,
      'frontend.line_count': String(lines),
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}

/**
 * Verbose cache-miss event from search-service — DROP.
 * Lives in `search-service × INFO` next to the legit index.shard.flush
 * KEEP logs. Looks like a normal INFO log but is chatty per-query.
 */
export function searchCacheMissVerboseLog(args: {
  rng: SeededRng;
  nowMs: number;
}): { body: string; attrs: Record<string, string> } {
  const { rng, nowMs } = args;
  const query = `q-${rng.hex(10)}`;
  return {
    body: logfmtBody({
      rng,
      nowMs,
      level: 'info',
      msg: 'search.cache.miss',
      fields: {
        'search.query_hash': query,
        'search.cache_layer': rng.pick(['l1', 'l2', 'edge']),
        'search.shard': rng.intRange(0, 32),
        'search.miss_reason': rng.pick([
          'ttl_expired',
          'evicted',
          'not_present',
          'invalidated',
        ]),
        'search.fallback_ms': rng.intRange(5, 90),
      },
    }),
    attrs: {
      'event.name': 'search.cache.miss',
      'search.query_hash': query,
      'log.iostream': 'stdout',
      logtag: 'F',
    },
  };
}
