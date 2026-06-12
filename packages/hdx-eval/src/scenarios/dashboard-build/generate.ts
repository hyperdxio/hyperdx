/**
 * dashboard-build scenario.
 *
 * Tests programmatic dashboard creation via MCP tools. The agent receives
 * a request to build an operational dashboard for a 3-service architecture
 * and must use the dashboard save/patch/query tools to create tiles that
 * return data.
 *
 * Dataset spans 1 hour ending at `nowMs`:
 *   - 3 services: `web-gateway`, `order-service`, `inventory-service`
 *   - `web-gateway`:      high-traffic entry point, ~60% of traces
 *   - `order-service`:    mid-traffic, has an error spike in last 15 min
 *   - `inventory-service`: low-traffic, consistent latency
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
import { makeLog } from '../../generators/logs';
import {
  buildResourcePool,
  pickResource,
  uuidv4,
} from '../../generators/templates';
import {
  makeSpan,
  msToNs,
  newSpanId,
  newTraceId,
} from '../../generators/traces';
import type { LogRow, TraceRow } from '../../generators/types';
import {
  formatDashboardEvidence,
  inspectDashboards,
} from '../../grading/dashboardInspection';
import type {
  GenerateContext,
  PostRunInspectionContext,
  PostRunInspectionResult,
  Scenario,
  ScenarioBatch,
  SystemPromptContext,
} from '../types';
import groundTruth from './ground-truth.json';

// ─── Volumes ─────────────────────────────────────────────────────────────────

const TOTAL_TRACES = 2_000_000; // ~33K/min × 60 min
const TOTAL_LOGS = 4_000_000; //  ~67K/min × 60 min

// Service traffic distribution
const SERVICE_WEIGHTS = {
  'web-gateway': 0.6,
  'order-service': 0.25,
  'inventory-service': 0.15,
} as const;

type ServiceName = keyof typeof SERVICE_WEIGHTS;
const SERVICES = Object.keys(SERVICE_WEIGHTS) as ServiceName[];

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
    // Pick service by weight
    const serviceRoll = rng.next();
    let cumWeight = 0;
    let service: ServiceName = 'web-gateway';
    for (const [svc, weight] of Object.entries(SERVICE_WEIGHTS)) {
      cumWeight += weight;
      if (serviceRoll < cumWeight) {
        service = svc as ServiceName;
        break;
      }
    }

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
        // Slow down error responses
        baseDurationMs *= rng.range(2, 5);
      }
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
    const serviceRoll = rng.next();
    let cumWeight = 0;
    let service: ServiceName = 'web-gateway';
    for (const [svc, weight] of Object.entries(SERVICE_WEIGHTS)) {
      cumWeight += weight;
      if (serviceRoll < cumWeight) {
        service = svc as ServiceName;
        break;
      }
    }

    const ts = Math.floor(rng.range(windowStartMs, nowMs));
    const resource = pickResource(rng, resourcePool, service);
    const reqId = uuidv4(rng);

    // Severity distribution
    let severity: LogRow['severityText'];
    let body: string;

    const sevRoll = rng.next();
    if (sevRoll < 0.5) {
      severity = 'INFO';
      body = rng.pick([
        `[${service}] request completed successfully reqId=${reqId} duration=${rng.intRange(10, 500)}ms`,
        `[${service}] cache hit for key=product:${rng.hex(4)} ttl=${rng.intRange(60, 3600)}s`,
        `[${service}] health check passed endpoint=/health status=ok`,
        `[${service}] connection pool stats: active=${rng.intRange(5, 50)} idle=${rng.intRange(0, 20)} waiting=${rng.intRange(0, 5)}`,
        `[${service}] rate limiter: bucket=${rng.pick(['default', 'premium', 'internal'])} remaining=${rng.intRange(100, 10000)}`,
      ]);
    } else if (sevRoll < 0.75) {
      severity = 'DEBUG';
      body = rng.pick([
        `[${service}] SQL query executed: SELECT * FROM ${rng.pick(['orders', 'products', 'inventory', 'users'])} WHERE id = '${rng.hex(8)}' duration=${rng.intRange(1, 100)}ms rows=${rng.intRange(0, 100)}`,
        `[${service}] serializing response payload size=${rng.intRange(100, 50000)}bytes format=json`,
        `[${service}] middleware chain: auth=${rng.intRange(1, 10)}ms rate_limit=${rng.intRange(0, 5)}ms parse=${rng.intRange(1, 15)}ms`,
        `[${service}] feature flag evaluation: flag=${rng.pick(['new_checkout', 'dark_mode', 'beta_api'])} result=${rng.pick(['true', 'false'])} context=user:${rng.hex(6)}`,
      ]);
    } else if (sevRoll < 0.9) {
      severity = 'WARN';
      body = rng.pick([
        `[${service}] slow query detected: table=${rng.pick(['orders', 'products', 'inventory'])} duration=${rng.intRange(500, 3000)}ms threshold=500ms`,
        `[${service}] circuit breaker half-open: target=${rng.pick(['inventory-service', 'payment-service', 'search-service'])} failures=${rng.intRange(3, 10)}`,
        `[${service}] retry attempt ${rng.intRange(1, 3)}/3 for operation=${rng.pick(['db_write', 'cache_set', 'queue_publish'])} backoff=${rng.intRange(100, 2000)}ms`,
        `[${service}] connection pool near capacity: active=${rng.intRange(40, 50)}/50 waiting=${rng.intRange(5, 15)}`,
      ]);
    } else {
      severity = 'ERROR';
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

    logs.push(
      makeLog({
        timestampMs: ts,
        serviceName: service,
        severityText: severity,
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
  agentPrompt: `Build an operational monitoring dashboard for our microservices architecture.

The dashboard should be named "Service Health Overview" and include:

1. A **dashboard-level filter** for ServiceName so the user can scope all tiles to a single service from the filter bar.

Organize tiles into collapsible sections using containers:

**Section 1: "Overview"** (not collapsed)
1. **Total Requests** — A single number tile showing total request count. Format as throughput with suffix " req" (use numberFormat).
2. **Error Count** — A single number tile showing total error count (filter to error status only).
3. **Request Rate** — A line chart showing request count over time, grouped by service name.
4. **Error Rate %** — A line chart showing error rate as a ratio: plot two series (total count and error count) with \`asRatio: true\` so it displays as a percentage over time, grouped by service.

**Section 2: "Latency"** (not collapsed, with two tabs: "By Service" and "Distribution")
5. **P95 Latency** — (tab: "By Service") A line chart showing p95 latency over time, grouped by service name. Display values as human-readable duration using numberFormat with factor 0.000000001 (Duration is in nanoseconds).
6. **Latency Heatmap** — (tab: "Distribution") A heatmap tile showing the distribution of Duration values over time. Format bucket values as duration with nanosecond factor.

**Section 3: "Errors"** (collapsed by default)
7. **Error Rate by Service** — A stacked bar chart showing error count over time, grouped by service name (filter to error status only).
8. **Error Breakdown** — A raw SQL tile (configType "sql", displayType "table") showing the top 20 StatusMessage values by count. Use the trace table directly with a ClickHouse SQL query that includes a $__timeFilter macro and LIMIT clause. Set the sourceId on the SQL tile so $__filters works.

**Section 4: "Endpoints"** (collapsed by default)
9. **Top Endpoints** — A table grouped by SpanName showing request count, avg duration (formatted as duration in nanoseconds), and error count. When a user clicks a row, it should drill into the trace search page pre-filtered to that endpoint's SpanName. Configure the onClick with type "search" targeting the trace source, and use a filter with expression "SpanName" and template "{{SpanName}}".
10. **Endpoint Search** — A search tile showing recent trace events.

**Section 5: "Logs"** (collapsed by default)
11. **Log Error Volume** — A line chart from the **log source** (not traces) showing count over time, filtered to ERROR severity, grouped by ServiceName.
12. **Recent Error Logs** — A search tile from the **log source** filtered to ERROR severity.

Use BOTH the trace and log data sources — discover them via list_sources and describe_source. After creating the dashboard, verify that tiles return data by querying at least 3 of them.

Report what you created: the dashboard name, how many tiles, which tile types, which sections, and whether the tiles returned data when queried.`,
  description:
    'Dashboard creation eval — agent must build a multi-source dashboard with ' +
    'containers (collapsible sections with tabs), dashboard-level filters, ' +
    'onClick drill-downs, computed ratio tiles, numberFormat, diverse tile types ' +
    '(line, stacked_bar, number, table, heatmap, search, raw SQL), and log-source ' +
    'tiles. Tests the full dashboard API surface at production complexity.',
  generate: generateDashboardBuild,
  groundTruth,

  // ─── Hooks ───────────────────────────────────────────────────────

  /** Unblock dashboard tools that are normally denied. */
  allowedToolPatterns: [
    'delete_dashboard',
    'get_dashboard',
    'save_dashboard',
    'patch_dashboard',
    'query_tile',
    'get_dashboard_tile',
    'search_dashboards',
  ],

  /** Custom system prompt for dashboard building. */
  buildSystemPrompt: (ctx: SystemPromptContext) =>
    buildDashboardSystemPrompt(ctx),

  /** Custom judge preamble that tells the judge to evaluate the artifact. */
  judgeSystemPreamble: `You are evaluating a dashboard-building task. You will receive:
- the scenario question (what the candidate was asked to build)
- the ground-truth facts (the expected dashboard structure, tile configs, and data)
- a rubric with weighted criteria
- the candidate's final answer (their text description of what they built)
- a DASHBOARD ARTIFACT section showing the ACTUAL dashboard that was created, inspected post-run by the eval harness — this includes the real tile configs and query results

IMPORTANT: Score based on the DASHBOARD ARTIFACT (the actual created dashboard), not just the candidate's text claims. The artifact shows exactly what tiles were configured and what data they returned. A candidate who claims success but whose tiles are misconfigured should score poorly. A candidate who is modest but built correct tiles should score well.

For each rubric criterion, output an integer score from 0 to 5 plus a one-sentence rationale.

Return STRICT JSON of shape:
{ "scores": { "<criterion_id>": { "score": N, "rationale": "..." } } }
No prose outside the JSON. Include every criterion id from the rubric.`,

  /** Post-run inspection: fetch dashboards, query tiles, collect evidence, cleanup. */
  postRunInspection: async (
    ctx: PostRunInspectionContext,
  ): Promise<PostRunInspectionResult> => {
    const result = await inspectDashboards(ctx);
    const evidence = formatDashboardEvidence(result);

    const totalTiles = result.totalTiles;
    const tilesWithData = result.tilesWithData;

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

// ─── Dashboard system prompt ─────────────────────────────────────────────────

function buildDashboardSystemPrompt(ctx: SystemPromptContext): string {
  const { traces, logs } = ctx.tables;

  const anchorBlock = ctx.anchorTimeIso
    ? `\nFIXED CURRENT TIME: ${ctx.anchorTimeIso}
All "now", "recently", "in the last N minutes/hours" references in the user's
prompt are anchored to this timestamp. When you create dashboard tiles, use
absolute ISO timestamps relative to this anchor — do NOT use today's
wall-clock date.\n`
    : '';

  return `You are building observability dashboards using MCP tools.
The OpenTelemetry data lives in ClickHouse:

- Traces table: default.${traces}
- Logs table:   default.${logs}
${anchorBlock}
CRITICAL WORKFLOW — follow these steps in order:

1. DISCOVER SOURCES: Call clickstack_list_sources to find available source
   IDs. You MUST use real source IDs from the API — do not invent them.
   The trace source and log source have different IDs.

2. DESCRIBE SOURCE: Call clickstack_describe_source on the source you plan
   to use. This reveals the exact column names, attribute keys, and sampled
   values. Column names are PascalCase (e.g., Duration, ServiceName,
   StatusCode, SpanName). Map attributes use bracket syntax:
   SpanAttributes['http.method'], ResourceAttributes['service.name'].
   Getting column names wrong is the #1 cause of tile failures.

3. CREATE DASHBOARD: Use clickstack_save_dashboard to create the dashboard
   with all tiles. Each tile needs a config with displayType, sourceId, and
   select array. Key rules:
   - displayType: "line", "stacked_bar", "table", "number", "pie", "heatmap", "search"
   - For "count" aggFn: no valueExpression needed
   - For "avg", "sum", "min", "max": valueExpression is required (e.g., "Duration")
   - For "quantile": valueExpression + level (0.5, 0.9, 0.95, 0.99) required
   - groupBy uses column names: "ServiceName", "SpanName", etc.
   - Error filtering: use where with StatusCode filter
   - Always set a human-readable alias on each select item
   - MULTI-SOURCE: Different tiles can use different sourceIds — log tiles
     use the log source, trace tiles use the trace source. Get both IDs
     from list_sources.
   - RAW SQL tiles: use configType "sql", set connectionId AND sourceId,
     include $__timeFilter macro and LIMIT clause
   - CONTAINERS: Use the containers array to group tiles into collapsible
     sections. Each container has { id, title, collapsed }. Tiles reference
     containerId. For tabs, add a tabs array to the container and set tabId.
   - DASHBOARD FILTERS: Use the filters array on save_dashboard to add
     filter dropdowns. Each filter needs type "QUERY_EXPRESSION", name,
     expression (column name), and sourceId.
   - onClick: Table tiles can have onClick for row-click drill-downs.
     Use type "search" with target { mode: "id", id: "<sourceId>" } and
     filters with kind "expressionTemplate".
   - asRatio: Set asRatio: true on a line chart with exactly 2 select
     items to show a ratio (e.g., error rate percentage).
   - numberFormat: Use { output: "duration", factor: 0.000000001 } on
     tiles showing Duration values (nanoseconds → human-readable).

4. VERIFY TILES: After creating the dashboard, call clickstack_query_tile
   on at least 2 tiles to confirm they return data. Tiles can be created
   with invalid configs that silently return empty results.

5. FIX ERRORS: If a tile fails or returns no data, use
   clickstack_patch_dashboard to fix it — you don't need to recreate the
   whole dashboard. Check the error message for clues (wrong column name,
   missing field, bad filter syntax).

TOOL ENVIRONMENT: MCP query tools, dashboard tools, and the Read tool are
available. There are NO shell, write, or search tools (Bash, Write, Edit,
Glob, Grep, etc.). The Read tool is restricted to your working directory.

TURN BUDGET: You have ~${ctx.maxTurns ?? 25} tool calls. Plan efficiently:
- list_sources = 1 call (required — discover both trace and log source IDs)
- describe_source = 1-2 calls (learn column names for each source)
- save_dashboard = 1 call (creates ALL tiles, containers, filters at once)
- query_tile = 1 call per tile verified (verify at least 3)
- patch_dashboard = 1 call per fix
Budget for ~3-5 verification + fix cycles after initial creation.

In your final answer, report:
- The dashboard name and ID
- How many tiles were created and their types
- Which tiles were verified and whether they returned data
- Any errors encountered and how they were resolved`;
}
