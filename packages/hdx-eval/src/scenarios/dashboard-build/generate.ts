/**
 * dashboard-build scenario.
 *
 * Tests programmatic dashboard creation via MCP tools. The agent receives
 * a request to build an operational dashboard for a 3-service architecture
 * and must use the dashboard save/patch/query tools to create tiles that
 * return data.
 *
 * Dataset spans 1 hour ending at `nowMs`:
 *   - 3 user-facing services: `web-gateway`, `order-service`, `inventory-service`
 *   - 4 internal/distractor services the agent should NOT surface as if they
 *     were user traffic: `health-checker`, `cron-scheduler`,
 *     `internal-metrics`, `debug-proxy`
 *   - `web-gateway`:      high-traffic entry point, ~40% of traces
 *   - `order-service`:    mid-traffic, has an error spike in last 15 min
 *   - `inventory-service`: low-traffic; its aggregate P95/P99 looks alarming
 *                          but that is entirely a slow admin export endpoint
 *                          (`GET /inventory/levels`), not the user paths
 *
 * Misleading-data traps (the eval's "real world is messy" surface):
 *   - Messy log severity: SeverityText is stored verbatim with mixed case and
 *     aliases (`error`/`ERROR`/`fatal`, `warn`/`warning`, `info`/`INFO`/
 *     `information`). A naive `SeverityText = 'ERROR'` filter misses ~30% of
 *     real errors; a groupBy SeverityText splits one level into many buckets.
 *   - Red-herring latency: inventory-service's high P99 is one admin endpoint.
 *   - Misleading distractor errors: debug-proxy's 15% error rate is debug
 *     traffic, not a real incident. cron-scheduler timeouts are normal batch.
 *   - Mixed environments: `staging` traffic is blended into `production`.
 *
 * The agent must:
 *   1. Discover available sources using list_sources / describe_source
 *   2. Create a dashboard with multiple tile types (line, table, number, etc.)
 *   3. Ensure tiles reference correct sourceIds and column names
 *   4. Verify tiles return data via query_tile
 *   5. Handle errors gracefully (wrong column names, bad filters, etc.)
 *
 * Hardness drivers:
 *   - Must use correct sourceId (not guess) — requires list_sources first
 *   - Column names are PascalCase (Duration, ServiceName) not lowercase
 *   - SpanAttributes/ResourceAttributes are Map columns requiring bracket syntax
 *   - Multiple display types require different config shapes
 *   - query_tile validation catches silent failures
 *   - Creating 6+ tiles in one dashboard exercises the full API surface
 *   - Error rate from tool failures (wrong schemas, missing fields) directly
 *     penalizes the score via the tool-error penalty mechanism
 */
import { makeLog } from '@/generators/logs';
import {
  buildResourcePool,
  pickResource,
  pickSeverityIn,
  uuidv4,
} from '@/generators/templates';
import {
  makeSpan,
  msToNs,
  newSpanId,
  newTraceId,
} from '@/generators/traces';
import type { LogRow, TraceRow } from '@/generators/types';
import {
  analyzeDistractorAwareness,
  formatDashboardEvidence,
  inspectDashboards,
} from '@/grading/dashboardInspection';
import { SAMPLING_CAVEAT_BLOCK } from '@/harness/systemPrompt';
import type {
  GenerateContext,
  PostRunInspectionContext,
  PostRunInspectionResult,
  Scenario,
  ScenarioBatch,
  SystemPromptContext,
} from '@/scenarios/types';
import groundTruth from './ground-truth.json';

// ─── Volumes ─────────────────────────────────────────────────────────────────

const TOTAL_TRACES = 2_000_000; // ~33K/min × 60 min
const TOTAL_LOGS = 4_000_000; //  ~67K/min × 60 min

// Service traffic distribution — includes distractor services that generate
// noise the agent must filter or ignore when building dashboards.
const SERVICE_WEIGHTS = {
  'web-gateway': 0.4,
  'order-service': 0.18,
  'inventory-service': 0.1,
  // Distractors — noisy internal services that clutter the data
  'health-checker': 0.12, // high-volume health probes, all OK, very fast
  'cron-scheduler': 0.08, // periodic batch jobs, bursty pattern
  'internal-metrics': 0.07, // metrics collection, lots of spans, no real user traffic
  'debug-proxy': 0.05, // debug/staging traffic, mixed status codes
} as const;

type ServiceName = keyof typeof SERVICE_WEIGHTS;
const SERVICES = Object.keys(SERVICE_WEIGHTS) as ServiceName[];

/** Pick a service using the cumulative weight distribution. */
function pickService(rng: { next(): number }): ServiceName {
  const roll = rng.next();
  let cumWeight = 0;
  for (const [svc, weight] of Object.entries(SERVICE_WEIGHTS)) {
    cumWeight += weight;
    if (roll < cumWeight) return svc as ServiceName;
  }
  return 'web-gateway';
}

// Endpoints per service
const ENDPOINTS: Record<ServiceName, string[]> = {
  'web-gateway': [
    'GET /api/products',
    'GET /api/orders',
    'POST /api/orders',
    'GET /api/inventory',
    'GET /api/health',
    'POST /api/auth/login',
  ],
  'order-service': [
    'POST /orders/create',
    'GET /orders/list',
    'GET /orders/detail',
    'POST /orders/cancel',
    'POST /orders/refund',
  ],
  'inventory-service': [
    'GET /inventory/check',
    'POST /inventory/reserve',
    'POST /inventory/release',
    'GET /inventory/levels',
  ],
  // Distractor endpoints — noisy, not user-facing
  'health-checker': ['GET /healthz', 'GET /readyz', 'GET /livez'],
  'cron-scheduler': [
    'POST /cron/sync-inventory',
    'POST /cron/cleanup-sessions',
    'POST /cron/aggregate-metrics',
  ],
  'internal-metrics': [
    'POST /metrics/collect',
    'POST /metrics/flush',
    'GET /metrics/status',
  ],
  'debug-proxy': ['GET /debug/headers', 'POST /debug/echo', 'GET /debug/env'],
};

// ─── Timing windows ──────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// ─── Generator ───────────────────────────────────────────────────────────────

function* generateDashboardBuild(
  ctx: GenerateContext,
): Iterable<ScenarioBatch> {
  const { rng, nowMs, volumeFactor = 1, batchSize = 10_000 } = ctx;

  const windowStartMs = nowMs - ONE_HOUR_MS;
  const errorSpikeStartMs = nowMs - FIFTEEN_MIN_MS;

  const traceCount = Math.round(TOTAL_TRACES * volumeFactor);
  const logCount = Math.round(TOTAL_LOGS * volumeFactor);

  const resourcePool = buildResourcePool({
    rng,
    services: SERVICES,
    instancesPerService: 16,
  });

  let traces: TraceRow[] = [];
  let logs: LogRow[] = [];

  // ─── Generate traces ─────────────────────────────────────────────
  for (let i = 0; i < traceCount; i++) {
    const service = pickService(rng);

    const endpoint = rng.pick(ENDPOINTS[service]);
    const method = endpoint.split(' ')[0];
    const path = endpoint.split(' ')[1];
    const ts = Math.floor(rng.range(windowStartMs, nowMs));
    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    const resource = pickResource(rng, resourcePool, service);

    // Base latency per service
    let baseDurationMs: number;
    switch (service) {
      case 'web-gateway':
        baseDurationMs = rng.range(10, 200);
        break;
      case 'order-service':
        baseDurationMs = rng.range(50, 400);
        break;
      case 'inventory-service':
        baseDurationMs = rng.range(20, 150);
        break;
      // Distractor services — distinctive latency profiles
      case 'health-checker':
        baseDurationMs = rng.range(1, 5); // very fast
        break;
      case 'cron-scheduler':
        baseDurationMs = rng.range(500, 15000); // very slow (batch jobs)
        break;
      case 'internal-metrics':
        baseDurationMs = rng.range(2, 20); // fast internal
        break;
      case 'debug-proxy':
        baseDurationMs = rng.range(10, 500); // variable
        break;
    }

    // Red-herring latency: the `GET /inventory/levels` endpoint is a
    // low-traffic admin/export call that scans the full catalog and is
    // expected to be slow (2-8s). It drags inventory-service's *aggregate*
    // P95/P99 way up, making the service look unhealthy at a glance — but
    // the user-facing paths (`/inventory/check`, `/inventory/reserve`,
    // `/inventory/release`) are all fast and fine. A good agent that
    // groups latency by endpoint (or excludes admin traffic) sees through
    // this; a naive service-level P99 tile presents a non-problem as a
    // problem.
    if (service === 'inventory-service' && path === '/inventory/levels') {
      baseDurationMs = rng.range(2000, 8000);
    }

    // Determine error status
    let statusCode: TraceRow['statusCode'] = 'STATUS_CODE_OK';
    let statusMessage = '';
    let httpStatus = method === 'POST' ? '201' : '200';

    // order-service error spike in last 15 minutes (~8% error rate)
    if (service === 'order-service' && ts >= errorSpikeStartMs) {
      if (rng.next() < 0.08) {
        statusCode = 'STATUS_CODE_ERROR';
        const errorType = rng.pick([
          'OrderValidationError',
          'InventoryUnavailableError',
          'PaymentTimeoutError',
        ]);
        statusMessage = `${errorType}: ${rng.pick([
          'insufficient inventory for SKU-' + rng.hex(4),
          'payment gateway timeout after 5000ms',
          'order validation failed: missing required field',
          'downstream service unavailable',
        ])}`;
        httpStatus = rng.pick(['400', '500', '503', '504']);
        baseDurationMs *= rng.range(2, 5);
      }
    }

    // debug-proxy: high error rate (misleading — it's debug traffic, not real)
    if (service === 'debug-proxy' && rng.next() < 0.15) {
      statusCode = 'STATUS_CODE_ERROR';
      statusMessage = rng.pick([
        'debug endpoint not found',
        'test assertion failed',
        'mock service timeout',
      ]);
      httpStatus = rng.pick(['404', '500']);
    }

    // cron-scheduler: occasional timeouts (normal for batch jobs)
    if (service === 'cron-scheduler' && rng.next() < 0.03) {
      statusCode = 'STATUS_CODE_ERROR';
      statusMessage = 'batch job exceeded time limit';
      httpStatus = '504';
    }

    // Background 0.3% error rate for all services
    if (statusCode === 'STATUS_CODE_OK' && rng.next() < 0.003) {
      statusCode = 'STATUS_CODE_ERROR';
      statusMessage = 'internal server error';
      httpStatus = '500';
    }

    traces.push(
      makeSpan({
        rng,
        timestampMs: ts,
        traceId,
        spanId,
        spanName: endpoint,
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: service,
        durationNs: msToNs(baseDurationMs),
        statusCode,
        statusMessage,
        resourceAttributes: resource,
        spanAttributes: {
          'http.method': method,
          'http.route': path,
          'http.status_code': httpStatus,
          'http.url': `https://api.example.com${path}`,
          'deployment.environment': rng.pick([
            'production',
            'production',
            'production',
            'staging',
          ]),
          // Attributes that exist but aren't useful for dashboards
          // (agents might try to use them and create misleading tiles)
          'thread.id': String(rng.intRange(1, 200)),
          'net.peer.port': String(rng.pick([80, 443, 8080, 8443, 3000])),
          ...(statusCode === 'STATUS_CODE_ERROR'
            ? { 'error.type': statusMessage.split(':')[0] }
            : {}),
        },
      }),
    );

    if (traces.length >= batchSize) {
      yield { traces, logs: [] };
      traces = [];
    }
  }

  // ─── Generate logs ────────────────────────────────────────────────
  for (let i = 0; i < logCount; i++) {
    const service = pickService(rng);

    const ts = Math.floor(rng.range(windowStartMs, nowMs));
    const resource = pickResource(rng, resourcePool, service);
    const reqId = uuidv4(rng);

    // Severity band drives the body template. The actual stored SeverityText
    // is intentionally MESSY — real OTel collectors aggregate logs from many
    // runtimes and emit inconsistent casing/aliases (info/INFO/information,
    // warn/warning, error/ERROR/fatal). This is a deliberate trap: a naive
    // `SeverityText = 'ERROR'` exact-match filter silently misses ~30% of
    // error rows (the lowercase `error` + `fatal` variants), and a groupBy
    // SeverityText splits one logical level into several buckets.
    let band: 'info' | 'debug' | 'warn' | 'error';
    let body: string;

    const sevRoll = rng.next();
    if (sevRoll < 0.5) {
      band = 'info';
      body = rng.pick([
        `[${service}] request completed successfully reqId=${reqId} duration=${rng.intRange(10, 500)}ms`,
        `[${service}] cache hit for key=product:${rng.hex(4)} ttl=${rng.intRange(60, 3600)}s`,
        `[${service}] health check passed endpoint=/health status=ok`,
        `[${service}] connection pool stats: active=${rng.intRange(5, 50)} idle=${rng.intRange(0, 20)} waiting=${rng.intRange(0, 5)}`,
        `[${service}] rate limiter: bucket=${rng.pick(['default', 'premium', 'internal'])} remaining=${rng.intRange(100, 10000)}`,
      ]);
    } else if (sevRoll < 0.75) {
      band = 'debug';
      body = rng.pick([
        `[${service}] SQL query executed: SELECT * FROM ${rng.pick(['orders', 'products', 'inventory', 'users'])} WHERE id = '${rng.hex(8)}' duration=${rng.intRange(1, 100)}ms rows=${rng.intRange(0, 100)}`,
        `[${service}] serializing response payload size=${rng.intRange(100, 50000)}bytes format=json`,
        `[${service}] middleware chain: auth=${rng.intRange(1, 10)}ms rate_limit=${rng.intRange(0, 5)}ms parse=${rng.intRange(1, 15)}ms`,
        `[${service}] feature flag evaluation: flag=${rng.pick(['new_checkout', 'dark_mode', 'beta_api'])} result=${rng.pick(['true', 'false'])} context=user:${rng.hex(6)}`,
      ]);
    } else if (sevRoll < 0.9) {
      band = 'warn';
      body = rng.pick([
        `[${service}] slow query detected: table=${rng.pick(['orders', 'products', 'inventory'])} duration=${rng.intRange(500, 3000)}ms threshold=500ms`,
        `[${service}] circuit breaker half-open: target=${rng.pick(['inventory-service', 'payment-service', 'search-service'])} failures=${rng.intRange(3, 10)}`,
        `[${service}] retry attempt ${rng.intRange(1, 3)}/3 for operation=${rng.pick(['db_write', 'cache_set', 'queue_publish'])} backoff=${rng.intRange(100, 2000)}ms`,
        `[${service}] connection pool near capacity: active=${rng.intRange(40, 50)}/50 waiting=${rng.intRange(5, 15)}`,
      ]);
    } else {
      band = 'error';
      // During error spike window, order-service produces more errors
      if (service === 'order-service' && ts >= errorSpikeStartMs) {
        body = rng.pick([
          `[order-service] OrderValidationError: order processing failed orderId=${rng.hex(8)} reason=insufficient_inventory sku=SKU-${rng.hex(4)}`,
          `[order-service] PaymentTimeoutError: payment gateway timeout after 5000ms orderId=${rng.hex(8)} gateway=stripe`,
          `[order-service] InventoryUnavailableError: inventory check failed sku=SKU-${rng.hex(4)} requested=${rng.intRange(1, 10)} available=0`,
          `[order-service] downstream service unavailable: target=inventory-service.internal:8080 error=connection_refused`,
        ]);
      } else {
        body = rng.pick([
          `[${service}] unhandled exception: ${rng.pick(['NullPointerException', 'TimeoutError', 'ConnectionResetError'])} reqId=${reqId}`,
          `[${service}] request failed: status=${rng.pick(['500', '502', '503'])} path=${rng.pick(['/api/orders', '/api/inventory', '/api/products'])} reqId=${reqId}`,
          `[${service}] database connection error: host=db-${service}.internal:5432 error=too_many_connections`,
        ]);
      }
    }

    // Derive the messy, verbatim severity text + number from the band.
    const sev = pickSeverityIn(rng, band);

    logs.push(
      makeLog({
        timestampMs: ts,
        serviceName: service,
        severityText: sev.text,
        severityNumber: sev.number,
        body,
        traceId: rng.next() < 0.7 ? newTraceId(rng) : undefined,
        spanId: rng.next() < 0.5 ? newSpanId(rng) : undefined,
        resourceAttributes: resource,
        logAttributes: {
          'deployment.environment': rng.pick(['production', 'staging']),
          'log.source': rng.pick(['stdout', 'stderr', 'file']),
        },
      }),
    );

    if (logs.length >= batchSize) {
      yield { traces: [], logs };
      logs = [];
    }
  }

  // Flush remaining
  if (traces.length > 0 || logs.length > 0) {
    yield { traces, logs };
  }
}

export const dashboardBuildScenario: Scenario = {
  name: 'dashboard-build',
  agentPrompt: `We need dashboards to monitor our microservices. Here's what we're looking for:

## Main Dashboard: "Service Health Overview"

We want a single pane of glass for our services. It should have a filter to scope to individual services. Organize the tiles into logical collapsible sections.

Things we want to see:

**At a glance:** Overall request volume, error counts, error rate as a percentage, and request trends over time broken down by service. Include a markdown header.

**Latency:** P95 latency trends by service (displayed as human-readable durations, not raw nanoseconds). A heatmap showing latency distribution. A pie chart bucketing requests into fast/medium/slow. Also a raw SQL chart showing both average overall latency and average error-only latency by service over time — we want to compare how much slower errors are vs normal requests.

**Errors:** Error volume over time by service as a stacked bar. Top error messages via raw SQL query.

**Endpoints:** A table of top endpoints with traffic, latency, and error counts — clicking a row should let you drill into the traces for that endpoint. Also show request breakdown by HTTP status code. And a search view for recent traces.

**Per-service drill-down:** A table of services that lets you click through to a detail dashboard for that service.

**Logs:** Error log trends over time by service, plus a search for recent error logs. Use the log data source for these, not traces.

**Also if possible:** CPU and memory usage per service, and request throughput in requests/second. Include these if the data supports it.

## Detail Dashboard: "Service Detail"

When someone clicks a service in the main dashboard, they should land on this dashboard scoped to that service. Show:

- Request rate over time
- P99 latency trend
- Recent error logs
- Top error messages by count

After creating both dashboards, verify tiles return data and report what you built. If any requested metrics aren't available in the data, note that too.`,
  description:
    'Dashboard creation eval — two dashboards with cross-dashboard onClick ' +
    'drill-down, ClickHouse expressions (if/bracket syntax/avgIf), containers ' +
    'with tabs, dashboard filters, asRatio, numberFormat, multi-source ' +
    '(trace+log), diverse tile types (line, stacked_bar, number, table, pie, ' +
    'heatmap, search, markdown, raw SQL as table + line). 22 tiles total.',
  generate: generateDashboardBuild,
  groundTruth,

  // ─── Hooks ───────────────────────────────────────────────────────

  allowedToolPatterns: [
    'delete_dashboard',
    'get_dashboard',
    'save_dashboard',
    'patch_dashboard',
    'query_tile',
    'get_dashboard_tile',
    'search_dashboards',
  ],

  buildSystemPrompt: buildDashboardSystemPrompt,

  judgeSystemPreamble: `You are evaluating a dashboard-building task. You will receive:
- the scenario question (what the candidate was asked to build)
- the ground-truth facts (the expected dashboard structure, tile configs, and data)
- a rubric with weighted criteria
- the candidate's final answer (their text description of what they built)
- a DASHBOARD ARTIFACT section showing the ACTUAL dashboards created, inspected post-run by the eval harness — this includes the real tile configs and query results

IMPORTANT: Score based on the DASHBOARD ARTIFACT (the actual created dashboards), not just the candidate's text claims. The artifact shows exactly what tiles were configured and what data they returned. A candidate who claims success but whose tiles are misconfigured should score poorly. A candidate who is modest but built correct tiles should score well.

For each rubric criterion, output an integer score from 0 to 5 plus a one-sentence rationale.

Return STRICT JSON of shape:
{ "scores": { "<criterion_id>": { "score": N, "rationale": "..." } } }
No prose outside the JSON. Include every criterion id from the rubric.`,

  postRunInspection: async (
    ctx: PostRunInspectionContext,
  ): Promise<PostRunInspectionResult> => {
    const result = await inspectDashboards(ctx);
    const evidence = formatDashboardEvidence(result);
    const distractorAwareness = analyzeDistractorAwareness(result);

    const totalTiles = result.totalTiles;
    const tilesWithData = result.tilesWithData;

    // Check cross-dashboard onClick validity: does any tile's onClick
    // target one of the other dashboard IDs we found?
    let crossDashboardOnClickValid = false;
    if (result.dashboardIds.length >= 2) {
      const idSet = new Set(result.dashboardIds);
      for (const tile of result.tileEvidence) {
        const onClick =
          (tile.intendedConfig?.onClick as Record<string, unknown>) ??
          (tile.config?.onClick as Record<string, unknown>);
        if (!onClick) continue;
        const target = onClick.target as Record<string, unknown> | undefined;
        if (target?.mode === 'id' && typeof target.id === 'string') {
          if (idSet.has(target.id)) {
            crossDashboardOnClickValid = true;
          }
        }
      }
    }

    return {
      evidence,
      summary: {
        dashboardCount: result.dashboardIds.length,
        totalTiles,
        tilesWithData,
        tileDataScore: totalTiles > 0 ? tilesWithData / totalTiles : 0,
        createCalls: result.createCalls,
        createSuccesses: result.createSuccesses,
        patchCalls: result.patchCalls,
        patchSuccesses: result.patchSuccesses,
        agentQueryTileCalls: result.agentQueryTileCalls,
        cleanedUp: result.cleanedUp.length,
        crossDashboardOnClickValid,
        distractorAwareness,
        tileDetails: result.tileEvidence.map(t => ({
          tileName: t.tileName,
          displayType: t.displayType,
          hasData: t.queryResult.hasData,
          error: t.queryResult.error,
        })),
        containerCount: result.containerEvidence.length,
        containers: result.containerEvidence.map(c => ({
          title: c.title,
          collapsed: c.collapsed,
          tileCount: c.tileCount,
        })),
      },
      cleanupIds: result.dashboardIds,
    };
  },
};

// ─── Dashboard system prompt (minimal — agent learns from tool schemas) ──────

function buildDashboardSystemPrompt(ctx: SystemPromptContext): string {
  const anchorBlock = ctx.anchorTimeIso
    ? `\nFIXED CURRENT TIME: ${ctx.anchorTimeIso}\nUse this as "now" for any time-based queries or filters. Do NOT use today's date.\n${SAMPLING_CAVEAT_BLOCK}`
    : '';

  return `You are building observability dashboards.
${anchorBlock}
ENVIRONMENT: Only MCP tools and the Read tool are available.
No Bash, Write, Edit, Glob, or Grep.

TURN BUDGET: ~${ctx.maxTurns ?? 30} tool calls. Plan carefully.

Report your results in the final answer.`;
}
