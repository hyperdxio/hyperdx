/**
 * Seeds local ClickHouse instance with test data for E2E tests
 *
 * Populates e2e_otel_logs, e2e_otel_traces, and e2e_hyperdx_sessions tables
 * with sample data. Timestamps are spread across a window that includes both
 * past and future relative to seed time ([seedRef - PAST_MS, seedRef + FUTURE_MS]).
 * This keeps "last 5 minutes" and similar relative time ranges finding data for
 * a reasonable period after seeding (e.g. ~2h). Optional: E2E_SEED_FUTURE_MS env
 * to tune the future buffer.
 */

interface ClickHouseConfig {
  host: string;
  user: string;
  password: string;
}

const DEFAULT_CONFIG: ClickHouseConfig = {
  host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  user: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
};

function createClickHouseClient(config: ClickHouseConfig = DEFAULT_CONFIG) {
  const baseUrl = new URL(config.host);
  baseUrl.searchParams.set('user', config.user);
  if (config.password) {
    baseUrl.searchParams.set('password', config.password);
  }

  return {
    async query(sql: string): Promise<string> {
      const response = await fetch(baseUrl.toString(), {
        method: 'POST',
        body: sql,
        headers: { 'Content-Type': 'text/plain' },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `ClickHouse query failed (${response.status}): ${error}`,
        );
      }

      return response.text();
    },
  };
}

// Test data constants (exported for E2E tests to pick visible filter values)
export const SEVERITIES = ['info', 'warn', 'error', 'debug'] as const;
export const SERVICES = [
  'api-server',
  'frontend',
  'CartService',
  'worker',
  'database',
  'accounting',
  'ad',
  'payment-service',
  'notification-service',
  'inventory-service',
] as const;
const LOG_MESSAGES = [
  'Request processed successfully',
  'Database connection established',
  'Cache hit for key',
  'User authentication successful',
  'Background info job completed',
  'Health check passed',
  'Configuration loaded',
  'Metrics exported',
  'Order created',
  'Order info updated',
  'Order deleted',
  'Order info fetched',
  'Order listed',
  'Order searched',
  'Order canceled',
  'Order completed',
  'Order info refunded',
] as const;
const SPAN_NAMES = [
  'GET /api/logs',
  'POST /api/traces',
  'AddItem',
  'database.query',
  'http.request',
  'cache.get',
  'auth.verify',
  'Order create',
  'Order update',
] as const;
const SPAN_KINDS = [
  'SPAN_KIND_SERVER',
  'SPAN_KIND_CLIENT',
  'SPAN_KIND_INTERNAL',
  'SPAN_KIND_PRODUCER',
  'SPAN_KIND_CONSUMER',
  'SPAN_KIND_UNSPECIFIED',
] as const;

// Kubernetes test data constants
const K8S_NAMESPACES = [
  'default',
  'kube-system',
  'production',
  'staging',
  'development',
  'monitoring',
  'logging',
] as const;
const K8S_NODES = [
  'node-1',
  'node-2',
  'node-3',
  'node-4',
  'node-5',
  'node-6',
  'node-7',
] as const;
const K8S_CLUSTERS = ['test-cluster'] as const;
// KubePhase enum: Pending = 1, Running = 2, Succeeded = 3, Failed = 4, Unknown = 5
const K8S_POD_PHASES = {
  PENDING: 1,
  RUNNING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  UNKNOWN: 5,
} as const;

// Time window for seeded data: past + future so "last N minutes" finds data after seed
const PAST_MS = 60 * 60 * 1000; // 1 hour
const FUTURE_MS =
  (process.env.E2E_SEED_FUTURE_MS &&
    parseInt(process.env.E2E_SEED_FUTURE_MS, 10)) ||
  2 * 60 * 60 * 1000; // 2 hours default

function generateLogData(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? startMs + (i / (count - 1)) * span : startMs;
    const timestampNs = Math.round(t) * 1000000;
    const severity = SEVERITIES[i % SEVERITIES.length];
    const service = SERVICES[i % SERVICES.length];
    const message = LOG_MESSAGES[i % LOG_MESSAGES.length];
    const traceId = i < 10 ? `trace-${i}` : ''; // Link first 10 logs to traces

    rows.push(
      `('${timestampNs}', '${traceId}', '', 0, '${severity}', 0, '${service}', '${message}', '', {'service.name':'${service}','environment':'test'}, '', '', '', {}, {'request.id':'req-${i}','user.id':'user-${i % 5}'})`,
    );
  }

  return rows.join(',\n');
}

function generateK8sLogData(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  // Use a distinct message prefix so (Timestamp, Body, ServiceName, SeverityText) is unique
  // vs regular logs. The table builds row WHERE from those columns only; if they matched a
  // regular log, the side panel would fetch the wrong row and the Infrastructure tab wouldn't show.
  const K8S_LOG_MESSAGE_PREFIX = 'K8s ';

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? startMs + (i / (count - 1)) * span : startMs;
    const timestampNs = Math.round(t) * 1000000;
    const severity = SEVERITIES[i % SEVERITIES.length];
    const message =
      K8S_LOG_MESSAGE_PREFIX + LOG_MESSAGES[i % LOG_MESSAGES.length];

    // Use existing pod/node/namespace data to correlate with metrics
    const podIdx = i % 30; // Match with the pods we generate in K8s metrics
    const namespace = K8S_NAMESPACES[podIdx % K8S_NAMESPACES.length];
    const node = K8S_NODES[podIdx % K8S_NODES.length];
    const cluster = K8S_CLUSTERS[0];
    const podName = `pod-${namespace}-${podIdx}`;
    const podUid = `uid-${podName}`;
    const containerName = `container-${podIdx}`;
    const serviceName = SERVICES[podIdx % SERVICES.length];

    const traceId = i < 10 ? `trace-${i}` : '';

    rows.push(
      `('${timestampNs}', '${traceId}', '', 0, '${severity}', 0, '${serviceName}', '${message}', '', {'k8s.cluster.name':'${cluster}','k8s.namespace.name':'${namespace}','k8s.node.name':'${node}','k8s.pod.name':'${podName}','k8s.pod.uid':'${podUid}','k8s.container.name':'${containerName}','service.name':'${podName}','environment':'test'}, '', '', '', {}, {'request.id':'req-${i}','container.id':'${containerName}'})`,
    );
  }

  return rows.join(',\n');
}

function generateTraceData(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const spansPerTrace = 4; // Each trace will have 4 spans
  const numTraces = Math.ceil(count / spansPerTrace);
  const span = endMs - startMs;

  for (let traceIdx = 0; traceIdx < numTraces; traceIdx++) {
    const traceId = `trace-${traceIdx}`;
    // Anchor each trace in the window; spans stay close (10s apart)
    const traceAnchor =
      numTraces > 1 ? startMs + (traceIdx / (numTraces - 1)) * span : startMs;
    const traceStartTime = traceAnchor;

    // Create spans within this trace
    for (let spanIdx = 0; spanIdx < spansPerTrace; spanIdx++) {
      const spanId = `span-${traceIdx}-${spanIdx}`;
      const parentSpanId =
        spanIdx === 0 ? '' : `span-${traceIdx}-${spanIdx - 1}`;

      // Each span starts slightly after the previous one (same trace grouping)
      const timestampNs = (traceStartTime - spanIdx * 100) * 1000000;

      const service = SERVICES[spanIdx % SERVICES.length];
      // Use row count to cycle through all span names, not just first 4
      const spanName = SPAN_NAMES[rows.length % SPAN_NAMES.length];
      const spanKind =
        spanIdx === 0
          ? 'SPAN_KIND_SERVER'
          : SPAN_KINDS[spanIdx % SPAN_KINDS.length];

      // 10% error rate for root spans
      const isError = traceIdx % 10 === 0 && spanIdx === 0;
      const statusCode = isError ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK';
      const httpStatusCode = isError ? '500' : '200';

      // Duration decreases for nested spans (child spans take less time)
      const duration =
        Math.floor(Math.random() * 500000000) +
        (spansPerTrace - spanIdx) * 100000000;

      rows.push(
        `('${timestampNs}', '${traceId}', '${spanId}', '${parentSpanId}', '', '${spanName}', '${spanKind}', '${service}', {'service.name':'${service}','environment':'test'}, '', '', {'http.method':'GET','http.status_code':'${httpStatusCode}'}, ${duration}, '${statusCode}', '', [], [], [], [], [], [], [])`,
      );

      // Stop if we've generated enough spans
      if (rows.length >= count) {
        return rows.join(',\n');
      }
    }
  }

  return rows.join(',\n');
}

function generateSessionData(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? startMs + (i / (count - 1)) * span : startMs;
    const timestampNs = Math.round(t) * 1000000;
    const sessionId = `session-${i}`;
    const traceId = `trace-${i}`;

    rows.push(
      `('${timestampNs}', '${traceId}', '', 0, 'INFO', 0, 'browser', '{"type":1,"data":"page_view"}', '', {'rum.sessionId':'${sessionId}','service.name':'browser'}, '', '', '', {}, {'page.url':'https://example.com/dashboard','user.id':'user-${i % 5}','teamId':'test-team','teamName':'Test Team','userEmail':'test${i % 5}@example.com','userName':'Test User ${i % 5}'})`,
    );
  }

  return rows.join(',\n');
}

function generateSessionTraces(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  for (let i = 0; i < count; i++) {
    const sessionId = `session-${i}`;
    const baseTime = count > 1 ? startMs + (i / (count - 1)) * span : startMs;

    const eventsPerSession = 5 + Math.floor(Math.random() * 10); // 5-15 events per session
    for (let eventIdx = 0; eventIdx < eventsPerSession; eventIdx++) {
      const timestampNs = (baseTime - eventIdx * 10000) * 1000000; // Events 10s apart
      const traceId = `session-trace-${i}-${eventIdx}`;
      const spanId = `session-span-${i}-${eventIdx}`;

      // Some sessions should have user interactions
      const isUserInteraction = eventIdx % 3 === 0;
      const hasRecording = i % 2 === 0; // 50% of sessions have recordings
      const isError = eventIdx === 0 && i % 5 === 0; // 20% of sessions have errors

      const spanName =
        hasRecording && eventIdx === 0 ? 'record init' : 'page_view';
      const component = isUserInteraction ? 'user-interaction' : 'page-view';
      const statusCode = isError ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK';

      const userIndex = i % 5;
      const userEmail = `test${userIndex}@example.com`;
      const userName = `Test User ${userIndex}`;
      const teamId = 'test-team-id';
      const teamName = 'Test Team';

      rows.push(
        `('${timestampNs}', '${traceId}', '${spanId}', '', '', '${spanName}', 'SPAN_KIND_INTERNAL', 'browser', {'rum.sessionId':'${sessionId}','service.name':'browser'}, '', '', {'component':'${component}','page.url':'https://example.com/dashboard','teamId':'${teamId}','teamName':'${teamName}','userEmail':'${userEmail}','userName':'${userName}'}, 0, '${statusCode}', '', [], [], [], [], [], [], [])`,
      );
    }
  }

  return rows.join(',\n');
}

function generateK8sGaugeMetrics(
  podCount: number,
  samplesPerPod: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;
  const seriesDurationMs = samplesPerPod * 60000; // 12 min per series
  const stepMs = 60000; // 60 second intervals

  // Generate metrics for each pod; spread each pod's series in the window
  for (let podIdx = 0; podIdx < podCount; podIdx++) {
    const namespace = K8S_NAMESPACES[podIdx % K8S_NAMESPACES.length];
    const node = K8S_NODES[podIdx % K8S_NODES.length];
    const cluster = K8S_CLUSTERS[0];
    const podName = `pod-${namespace}-${podIdx}`;
    const containerName = `container-${podIdx}`;
    let phase: number;
    if (podIdx % 15 === 0) {
      phase = K8S_POD_PHASES.FAILED;
    } else if (podIdx % 7 === 0) {
      phase = K8S_POD_PHASES.PENDING;
    } else {
      phase = K8S_POD_PHASES.RUNNING;
    }
    const restarts = podIdx % 7;

    const podSlotStart =
      podCount > 1
        ? startMs + (podIdx / (podCount - 1)) * (span - seriesDurationMs)
        : startMs;
    for (let sample = 0; sample < samplesPerPod; sample++) {
      const timestampMs = podSlotStart + sample * stepMs;
      const timestampNs = timestampMs * 1000000;
      const _timeUnix = timestampMs / 1000;

      // CPU metrics (percentage, 0-100)
      const cpuUsage = 10 + (podIdx % 40) + Math.sin(sample / 2) * 5;
      const cpuLimit = 100;
      const cpuLimitUtilization = (cpuUsage / cpuLimit) * 100;

      // Memory metrics (bytes)
      const memoryUsage = (100 + (podIdx % 400)) * 1024 * 1024; // 100-500 MB
      const memoryLimit = 1024 * 1024 * 1024; // 1 GB
      const memoryLimitUtilization = (memoryUsage / memoryLimit) * 100;

      const resourceAttrs = `{'k8s.cluster.name':'${cluster}','k8s.namespace.name':'${namespace}','k8s.node.name':'${node}','k8s.pod.name':'${podName}','k8s.pod.uid':'uid-${podName}','k8s.container.name':'${containerName}'}`;

      // k8s.pod.phase
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.phase', 'Pod phase', '', {}, ${timestampNs}, ${timestampNs}, ${phase}, 0, [], [], [], [], [])`,
      );

      // k8s.container.restarts
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.container.restarts', 'Container restarts', '', {}, ${timestampNs}, ${timestampNs}, ${restarts}, 0, [], [], [], [], [])`,
      );

      // container.cpu.utilization (0-100%)
      const containerCpuUtilization =
        5 + (podIdx % 30) + Math.sin(sample / 3) * 3;
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'container.cpu.utilization', 'Container CPU utilization', '%', {}, ${timestampNs}, ${timestampNs}, ${containerCpuUtilization}, 0, [], [], [], [], [])`,
      );

      // k8s.pod.cpu.utilization
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.cpu.utilization', 'Pod CPU utilization', '', {}, ${timestampNs}, ${timestampNs}, ${cpuUsage}, 0, [], [], [], [], [])`,
      );

      // k8s.pod.cpu_limit_utilization
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.cpu_limit_utilization', 'Pod CPU limit utilization', '%', {}, ${timestampNs}, ${timestampNs}, ${cpuLimitUtilization}, 0, [], [], [], [], [])`,
      );

      // k8s.pod.memory.usage
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.memory.usage', 'Pod memory usage', 'bytes', {}, ${timestampNs}, ${timestampNs}, ${memoryUsage}, 0, [], [], [], [], [])`,
      );

      // k8s.pod.memory_limit_utilization
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.memory_limit_utilization', 'Pod memory limit utilization', '%', {}, ${timestampNs}, ${timestampNs}, ${memoryLimitUtilization}, 0, [], [], [], [], [])`,
      );
    }
  }

  // Generate node metrics (spread across window)
  for (let nodeIdx = 0; nodeIdx < K8S_NODES.length; nodeIdx++) {
    const node = K8S_NODES[nodeIdx];
    const cluster = K8S_CLUSTERS[0];
    const nodeSlotStart =
      K8S_NODES.length > 1
        ? startMs +
          (nodeIdx / (K8S_NODES.length - 1)) * (span - seriesDurationMs)
        : startMs;

    for (let sample = 0; sample < samplesPerPod; sample++) {
      const timestampMs = nodeSlotStart + sample * stepMs;
      const timestampNs = timestampMs * 1000000;

      const nodeCpuUsage = 30 + (nodeIdx % 30) + Math.sin(sample / 2) * 10;
      const nodeMemoryUsage = (2 + nodeIdx) * 1024 * 1024 * 1024; // 2-4 GB
      const nodeConditionReady = 1; // 1 = Ready, 0 = NotReady

      const resourceAttrs = `{'k8s.cluster.name':'${cluster}','k8s.node.name':'${node}'}`;

      // k8s.node.cpu.utilization
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.node.cpu.utilization', 'Node CPU utilization', '', {}, ${timestampNs}, ${timestampNs}, ${nodeCpuUsage}, 0, [], [], [], [], [])`,
      );

      // k8s.node.memory.usage
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.node.memory.usage', 'Node memory usage', 'bytes', {}, ${timestampNs}, ${timestampNs}, ${nodeMemoryUsage}, 0, [], [], [], [], [])`,
      );

      // k8s.node.condition_ready
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.node.condition_ready', 'Node condition ready', '', {}, ${timestampNs}, ${timestampNs}, ${nodeConditionReady}, 0, [], [], [], [], [])`,
      );
    }
  }

  // Generate namespace metrics (spread across window)
  for (let nsIdx = 0; nsIdx < K8S_NAMESPACES.length; nsIdx++) {
    const namespace = K8S_NAMESPACES[nsIdx];
    const cluster = K8S_CLUSTERS[0];
    const namespacePhase = 1;
    const nsSlotStart =
      K8S_NAMESPACES.length > 1
        ? startMs +
          (nsIdx / (K8S_NAMESPACES.length - 1)) * (span - seriesDurationMs)
        : startMs;

    for (let sample = 0; sample < samplesPerPod; sample++) {
      const timestampMs = nsSlotStart + sample * stepMs;
      const timestampNs = timestampMs * 1000000;

      const resourceAttrs = `{'k8s.cluster.name':'${cluster}','k8s.namespace.name':'${namespace}'}`;

      // k8s.namespace.phase
      rows.push(
        `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.namespace.phase', 'Namespace phase', '', {}, ${timestampNs}, ${timestampNs}, ${namespacePhase}, 0, [], [], [], [], [])`,
      );
    }
  }

  return rows.join(',\n');
}

function generateK8sSumMetrics(
  podCount: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  for (let podIdx = 0; podIdx < podCount; podIdx++) {
    const namespace = K8S_NAMESPACES[podIdx % K8S_NAMESPACES.length];
    const node = K8S_NODES[podIdx % K8S_NODES.length];
    const cluster = K8S_CLUSTERS[0];
    const podName = `pod-${namespace}-${podIdx}`;
    const containerName = `container-${podIdx}`;

    const timestampMs =
      podCount > 1 ? startMs + (podIdx / (podCount - 1)) * span : startMs;
    const timestampNs = timestampMs * 1000000;

    // Pod uptime in seconds (1-10 hours)
    const uptimeSeconds = (1 + (podIdx % 10)) * 3600;

    const resourceAttrs = `{'k8s.cluster.name':'${cluster}','k8s.namespace.name':'${namespace}','k8s.node.name':'${node}','k8s.pod.name':'${podName}','k8s.pod.uid':'uid-${podName}','k8s.container.name':'${containerName}'}`;

    // k8s.pod.uptime (Sum metric)
    // AggregationTemporality: 1 = Delta, 2 = Cumulative
    rows.push(
      `(${resourceAttrs}, '', '', '', {}, 0, '', 'k8s-metrics', 'k8s.pod.uptime', 'Pod uptime', 's', {}, ${timestampNs}, ${timestampNs}, ${uptimeSeconds}, 0, 2, true, [], [], [], [], [])`,
    );
  }

  return rows.join(',\n');
}

function generateK8sEventLogs(
  count: number,
  startMs: number,
  endMs: number,
): string {
  const rows: string[] = [];
  const span = endMs - startMs;

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? startMs + (i / (count - 1)) * span : startMs;
    const timestampNs = Math.round(t) * 1000000;
    const namespace = K8S_NAMESPACES[i % K8S_NAMESPACES.length];
    const node = K8S_NODES[i % K8S_NODES.length];
    const cluster = K8S_CLUSTERS[0];
    const podName = `pod-${namespace}-${i % 10}`;
    const podUid = `uid-${podName}`;
    const isWarning = i % 3 === 0; // More warning events (33%)
    const severity = isWarning ? 'Warning' : 'Normal';
    const eventType = isWarning ? 'Warning' : 'Normal';
    const message = isWarning
      ? `Back-off restarting failed container ${podName}`
      : `Started container ${podName}`;
    const regardingKind = isWarning ? 'Node' : 'Pod';
    const regardingName = isWarning ? node : podName;

    // Create the event object JSON
    const eventObject = {
      type: eventType,
      regarding: {
        kind: regardingKind,
        name: regardingName,
      },
      note: message,
    };
    const eventObjectJson = JSON.stringify(eventObject)
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'");

    // Include k8s.pod.uid so the infrastructure tab shows the Pod subpanel when this row is
    // clicked (DBInfraPanel requires rowData.__hdx_resource_attributes['k8s.pod.uid']).
    rows.push(
      `('${timestampNs}', '', '', 0, '${severity}', 0, 'k8s-events', '${message}', '', {'k8s.cluster.name':'${cluster}','k8s.namespace.name':'${namespace}','k8s.node.name':'${node}','k8s.pod.name':'${podName}','k8s.pod.uid':'${podUid}','service.name':'k8s-events'}, '', '', '', {}, {'k8s.resource.name':'events','object':'${eventObjectJson}'})`,
    );
  }

  return rows.join(',\n');
}

// CI can be slower, so use a longer timeout
const CLICKHOUSE_READY_TIMEOUT_SECONDS = parseInt(
  process.env.E2E_CLICKHOUSE_READY_TIMEOUT || '60',
  10,
);

async function waitForClickHouse(
  client: ReturnType<typeof createClickHouseClient>,
): Promise<void> {
  console.log('  Waiting for ClickHouse to be ready...');
  console.log(
    `  Attempting connection to: ${DEFAULT_CONFIG.host} (user: ${DEFAULT_CONFIG.user})`,
  );

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CLICKHOUSE_READY_TIMEOUT_SECONDS; attempt++) {
    try {
      await client.query('SELECT 1');
      console.log('  ClickHouse is ready');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt % 5 === 0) {
        // Log every 5 seconds
        console.log(
          `  Still waiting... (${attempt}/${CLICKHOUSE_READY_TIMEOUT_SECONDS}s)`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.error('  Last connection error:', lastError?.message);
  throw new Error(
    `ClickHouse not ready after ${CLICKHOUSE_READY_TIMEOUT_SECONDS} seconds. ` +
      `Host: ${DEFAULT_CONFIG.host}. ` +
      `Last error: ${lastError?.message || 'Unknown'}`,
  );
}

async function clearTestData(
  client: ReturnType<typeof createClickHouseClient>,
): Promise<void> {
  console.log('  Clearing existing test data...');
  await client.query('TRUNCATE TABLE IF EXISTS default.e2e_otel_logs');
  await client.query('TRUNCATE TABLE IF EXISTS default.e2e_otel_traces');
  await client.query('TRUNCATE TABLE IF EXISTS default.e2e_hyperdx_sessions');
  await client.query('TRUNCATE TABLE IF EXISTS default.e2e_otel_metrics_gauge');
  await client.query('TRUNCATE TABLE IF EXISTS default.e2e_otel_metrics_sum');
  console.log('  Existing data cleared');
}

export async function seedClickHouse(): Promise<void> {
  console.log('Seeding ClickHouse with test data...');
  const client = createClickHouseClient();

  await waitForClickHouse(client);
  await clearTestData(client);

  const seedRef = Date.now();
  const startMs = seedRef - PAST_MS;
  const endMs = seedRef + FUTURE_MS;
  const numDataPoints = 500;

  // Insert log data
  console.log('  Inserting log data...');
  await client.query(`
    INSERT INTO default.e2e_otel_logs (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${generateLogData(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} log entries`);

  // Insert K8s-aware log data (logs with k8s resource attributes for infrastructure correlation)
  console.log('  Inserting K8s log data...');
  await client.query(`
    INSERT INTO default.e2e_otel_logs (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${generateK8sLogData(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} K8s log entries`);

  // Insert trace data
  console.log('  Inserting trace data...');
  await client.query(`
    INSERT INTO default.e2e_otel_traces (
      Timestamp, TraceId, SpanId, ParentSpanId, TraceState, SpanName, SpanKind,
      ServiceName, ResourceAttributes, ScopeName, ScopeVersion, SpanAttributes,
      Duration, StatusCode, StatusMessage, \`Events.Timestamp\`, \`Events.Name\`,
      \`Events.Attributes\`, \`Links.TraceId\`, \`Links.SpanId\`, \`Links.TraceState\`,
      \`Links.Attributes\`
    ) VALUES ${generateTraceData(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} trace spans`);

  // Insert session trace data (spans with rum.sessionId for session tracking)
  console.log('  Inserting session trace data...');
  await client.query(`
    INSERT INTO default.e2e_otel_traces (
      Timestamp, TraceId, SpanId, ParentSpanId, TraceState, SpanName, SpanKind,
      ServiceName, ResourceAttributes, ScopeName, ScopeVersion, SpanAttributes,
      Duration, StatusCode, StatusMessage, \`Events.Timestamp\`, \`Events.Name\`,
      \`Events.Attributes\`, \`Links.TraceId\`, \`Links.SpanId\`, \`Links.TraceState\`,
      \`Links.Attributes\`
    ) VALUES ${generateSessionTraces(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} session trace data`);

  // Insert session data
  console.log('  Inserting session data...');
  await client.query(`
    INSERT INTO default.e2e_hyperdx_sessions (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${generateSessionData(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} session entries`);

  // Insert Kubernetes gauge metrics (pods and nodes)
  console.log('  Inserting Kubernetes gauge metrics...');
  await client.query(`
    INSERT INTO default.e2e_otel_metrics_gauge (
      ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes,
      ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName, MetricName, MetricDescription,
      MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value, Flags,
      \`Exemplars.FilteredAttributes\`, \`Exemplars.TimeUnix\`, \`Exemplars.Value\`,
      \`Exemplars.SpanId\`, \`Exemplars.TraceId\`
    ) VALUES ${generateK8sGaugeMetrics(numDataPoints, 12, startMs, endMs)}
  `);
  console.log(
    `  Inserted ${numDataPoints} Kubernetes gauge metrics (pods and nodes)`,
  );

  // Insert Kubernetes sum metrics (uptime)
  console.log('  Inserting Kubernetes sum metrics...');
  await client.query(`
    INSERT INTO default.e2e_otel_metrics_sum (
      ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes,
      ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName, MetricName, MetricDescription,
      MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value, Flags,
      AggregationTemporality, IsMonotonic,
      \`Exemplars.FilteredAttributes\`, \`Exemplars.TimeUnix\`, \`Exemplars.Value\`,
      \`Exemplars.SpanId\`, \`Exemplars.TraceId\`
    ) VALUES ${generateK8sSumMetrics(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} Kubernetes sum metrics (uptime)`);

  // Insert Kubernetes event logs
  console.log('  Inserting Kubernetes event logs...');
  await client.query(`
    INSERT INTO default.e2e_otel_logs (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${generateK8sEventLogs(numDataPoints, startMs, endMs)}
  `);
  console.log(`  Inserted ${numDataPoints} Kubernetes event logs`);

  console.log('ClickHouse seeding complete');
}

// Allow running directly for testing
if (require.main === module) {
  seedClickHouse()
    .then(() => {
      console.log('Seeding completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}
