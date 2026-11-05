import { context, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import os from 'os';

import { sendUsageStats } from '@/tasks/usageStats';

const mockExporter = new InMemoryLogRecordExporter();

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: jest.fn(() => mockExporter),
}));

describe('sendUsageStats', () => {
  beforeEach(() => {
    mockExporter.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exports one record to the usage stats endpoint with its own key', async () => {
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
      chStats: { tables: { otel_logs: { rows: 10 } }, rows: 10 },
    });

    expect(OTLPLogExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://in-otel.hyperdx.io/v1/logs',
        headers: { authorization: expect.any(String) },
      }),
    );

    const records = mockExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.body).toBe('track-hyperdx-oss-usage-stats');
    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    expect(record.severityText).toBe('info');
    expect(record.instrumentationScope.name).toBe('node-logger');
    expect(record.spanContext).toBeUndefined();
    expect(record.attributes).toEqual({
      clusterId: 'cluster-1',
      userCounts: 2,
      chStats: { tables: { otel_logs: { rows: 10 } }, rows: 10 },
      time: expect.any(Number),
      pid: process.pid,
      hostname: os.hostname(),
    });
    expect(record.resource.attributes['service.name']).toBe(
      'hyperdx-oss-usage-stats',
    );
  });

  it('sends NaN as null and drops undefined fields, as the pino records did', async () => {
    await sendUsageStats({
      clusterId: undefined,
      chStats: { tables: { otel_logs: { avgDaySize: NaN, rows: 10 } } },
    });

    const [record] = mockExporter.getFinishedLogRecords();
    expect(record.attributes).not.toHaveProperty('clusterId');
    expect(record.attributes.chStats).toEqual({
      tables: { otel_logs: { avgDaySize: null, rows: 10 } },
    });
  });
});
