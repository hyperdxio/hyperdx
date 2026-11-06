import { context, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import os from 'os';

import { sendUsageStats } from '@/tasks/usageStats';

const USAGE_STATS_URL = 'https://in-otel.hyperdx.io/v1/logs';
const USAGE_STATS_API_KEY = '3f26ffad-14cf-4fb7-9dc9-e64fa0b84ee0';

// jest.setup.ts replaces the global fetch with a jest.fn.
const mockFetch = jest.mocked(fetch);

const sentRequest = async () => {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, init] = mockFetch.mock.calls[0];
  return { url, init, body: await new Response(init?.body).json() };
};

describe('sendUsageStats', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Headers meant for the operator's collector, which must not reach
    // HyperDX.
    process.env.OTEL_EXPORTER_OTLP_HEADERS =
      'x-secret=1,Authorization=self-key';
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'x-logs=2';
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('posts one record to the usage stats endpoint with only its own key', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    // A traced caller, so the record would pick up its span without an
    // explicit context.
    jest.spyOn(context, 'active').mockReturnValue(
      trace.setSpanContext(ROOT_CONTEXT, {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: TraceFlags.SAMPLED,
      }),
    );

    await sendUsageStats({
      clusterId: 'cluster-1',
      userCounts: 2,
      chStats: { rows: 10 },
    });

    const { url, init, body } = await sentRequest();
    expect(url).toBe(USAGE_STATS_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      authorization: USAGE_STATS_API_KEY,
      'content-type': 'application/json',
    });
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);

    expect(body.resourceLogs).toHaveLength(1);
    const [resourceLogs] = body.resourceLogs;
    expect(resourceLogs.resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'hyperdx-oss-usage-stats' },
    });
    expect(resourceLogs.scopeLogs).toHaveLength(1);
    const [scopeLogs] = resourceLogs.scopeLogs;
    expect(scopeLogs.scope.name).toBe('node-logger');
    expect(scopeLogs.logRecords).toHaveLength(1);
    const [record] = scopeLogs.logRecords;
    expect(record.body).toEqual({
      stringValue: 'track-hyperdx-oss-usage-stats',
    });
    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    expect(record.severityText).toBe('info');
    expect(record).not.toHaveProperty('traceId');
    expect(record).not.toHaveProperty('spanId');
    expect(record.attributes).toEqual([
      { key: 'clusterId', value: { stringValue: 'cluster-1' } },
      { key: 'userCounts', value: { intValue: 2 } },
      {
        key: 'chStats',
        value: {
          kvlistValue: { values: [{ key: 'rows', value: { intValue: 10 } }] },
        },
      },
      { key: 'time', value: { intValue: expect.any(Number) } },
      { key: 'pid', value: { intValue: process.pid } },
      { key: 'hostname', value: { stringValue: os.hostname() } },
    ]);
  });

  it('sends NaN as null and drops undefined fields, as the pino records did', async () => {
    await sendUsageStats({
      clusterId: undefined,
      chStats: { avgDaySize: NaN, rows: 10 },
    });

    const { body } = await sentRequest();
    const [record] = body.resourceLogs[0].scopeLogs[0].logRecords;
    expect(record.attributes).not.toContainEqual(
      expect.objectContaining({ key: 'clusterId' }),
    );
    expect(record.attributes).toContainEqual({
      key: 'chStats',
      value: {
        kvlistValue: {
          values: [
            // An empty AnyValue, which is how OTLP JSON carries null
            { key: 'avgDaySize', value: {} },
            { key: 'rows', value: { intValue: 10 } },
          ],
        },
      },
    });
  });

  it('resolves when the request fails', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(sendUsageStats({ userCounts: 1 })).resolves.toBeUndefined();

    mockFetch.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(sendUsageStats({ userCounts: 1 })).resolves.toBeUndefined();
  });
});
