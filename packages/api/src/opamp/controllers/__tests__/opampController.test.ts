// Use mutable object so individual tests can flip flags. The values here are
// the defaults used by every test unless explicitly overridden.
const configState = {
  IS_ALL_IN_ONE_IMAGE: false,
  IS_LOCAL_APP_MODE: false,
  IS_DEV: false,
  INGESTION_API_KEY: '' as string,
  IS_PROMQL_ENABLED: false,
  ENABLE_DATADOG_RECEIVER: false,
  IS_SPAN_METRICS_ENABLED: false,
  IS_SPAN_METRICS_PROM_RW_ENABLED: false,
  SPAN_METRICS_PROM_RW_ENDPOINT: undefined as string | undefined,
};

jest.mock('@/config', () => ({
  get IS_ALL_IN_ONE_IMAGE() {
    return configState.IS_ALL_IN_ONE_IMAGE;
  },
  get IS_LOCAL_APP_MODE() {
    return configState.IS_LOCAL_APP_MODE;
  },
  get IS_DEV() {
    return configState.IS_DEV;
  },
  get INGESTION_API_KEY() {
    return configState.INGESTION_API_KEY;
  },
  get IS_PROMQL_ENABLED() {
    return configState.IS_PROMQL_ENABLED;
  },
  get ENABLE_DATADOG_RECEIVER() {
    return configState.ENABLE_DATADOG_RECEIVER;
  },
  get IS_SPAN_METRICS_ENABLED() {
    return configState.IS_SPAN_METRICS_ENABLED;
  },
  get IS_SPAN_METRICS_PROM_RW_ENABLED() {
    return configState.IS_SPAN_METRICS_PROM_RW_ENABLED;
  },
  get SPAN_METRICS_PROM_RW_ENDPOINT() {
    return configState.SPAN_METRICS_PROM_RW_ENDPOINT;
  },
}));

import { buildOtelCollectorConfig } from '@/opamp/controllers/opampController';

const resetConfig = () => {
  configState.IS_ALL_IN_ONE_IMAGE = false;
  configState.IS_LOCAL_APP_MODE = false;
  configState.IS_DEV = false;
  configState.INGESTION_API_KEY = '';
  configState.IS_PROMQL_ENABLED = false;
  configState.ENABLE_DATADOG_RECEIVER = false;
  configState.IS_SPAN_METRICS_ENABLED = false;
  configState.IS_SPAN_METRICS_PROM_RW_ENABLED = false;
  configState.SPAN_METRICS_PROM_RW_ENDPOINT = undefined;
};

describe('opampController', () => {
  beforeEach(() => {
    resetConfig();
  });

  describe('buildOtelCollectorConfig datadog receiver', () => {
    it('omits the datadog receiver when the flag is off (default)', () => {
      configState.ENABLE_DATADOG_RECEIVER = false;

      const cfg = buildOtelCollectorConfig([]);

      expect(cfg.receivers.datadog).toBeUndefined();
      expect(cfg.service.pipelines.traces.receivers).not.toContain('datadog');
      expect(cfg.service.pipelines.metrics.receivers).not.toContain('datadog');
      expect(cfg.service.pipelines['logs/in'].receivers).not.toContain(
        'datadog',
      );
    });

    it('attaches the datadog receiver to the traces, metrics, and logs pipelines when the flag is on', () => {
      configState.ENABLE_DATADOG_RECEIVER = true;

      const cfg = buildOtelCollectorConfig([]);

      expect(cfg.receivers.datadog).toMatchObject({
        endpoint: '0.0.0.0:8126',
        read_timeout: '60s',
      });
      // The single DD receiver serves all three signals; attach it to each.
      expect(cfg.service.pipelines.traces.receivers).toContain('datadog');
      expect(cfg.service.pipelines.metrics.receivers).toContain('datadog');
      expect(cfg.service.pipelines['logs/in'].receivers).toContain('datadog');
    });

    it('leaves the datadog receiver unauthenticated when no team API keys exist', () => {
      configState.ENABLE_DATADOG_RECEIVER = true;

      const cfg = buildOtelCollectorConfig([]);

      // No API keys -> no auth wiring, mirroring otlp/hyperdx.
      expect(cfg.receivers.datadog?.auth).toBeUndefined();
      expect(cfg.extensions['bearertokenauth/datadog']).toBeUndefined();
      expect(cfg.service.extensions).not.toContain('bearertokenauth/datadog');
    });

    it('leaves the datadog receiver unauthenticated when collector authentication is not enforced', () => {
      configState.ENABLE_DATADOG_RECEIVER = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      // Keys exist but auth is not enforced -> no auth wiring, mirroring
      // otlp/hyperdx.
      expect(cfg.receivers.datadog?.auth).toBeUndefined();
      expect(cfg.extensions['bearertokenauth/datadog']).toBeUndefined();
      expect(cfg.service.extensions).not.toContain('bearertokenauth/datadog');
    });

    it('authenticates the datadog receiver with team API keys via the DD-API-KEY header', () => {
      configState.ENABLE_DATADOG_RECEIVER = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: true },
        { apiKey: 'k2', collectorAuthenticationEnforced: true },
      ]);

      // Bearer-token extension keyed on DD-API-KEY with the team API keys.
      expect(cfg.extensions['bearertokenauth/datadog']).toEqual({
        header: 'DD-API-KEY',
        scheme: '',
        tokens: ['k1', 'k2'],
      });
      // Receiver references the authenticator and the extension is enabled.
      expect(cfg.receivers.datadog?.auth).toEqual({
        authenticator: 'bearertokenauth/datadog',
      });
      expect(cfg.service.extensions).toContain('bearertokenauth/datadog');
      // The otlp/hyperdx auth extension stays intact alongside it.
      expect(cfg.service.extensions).toContain('bearertokenauth/hyperdx');
    });
  });

  describe('buildOtelCollectorConfig span metrics', () => {
    it('omits the span metrics connector when the flag is off (default)', () => {
      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);
      expect(cfg.connectors?.span_metrics).toBeUndefined();
    });

    it('derives span metrics as exponential histograms with exemplars', () => {
      configState.IS_SPAN_METRICS_ENABLED = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      // Exponential rather than explicit buckets: a fixed ladder's wide top
      // bucket makes high quantiles interpolate well past the slowest real
      // request, so no exemplar can ever sit on the plotted line.
      expect(cfg.connectors?.span_metrics?.histogram).toEqual({
        unit: 'ms',
        exponential: { max_size: 160 },
      });
      expect(cfg.connectors?.span_metrics?.exemplars).toEqual({
        enabled: true,
      });
      expect(cfg.service.pipelines['metrics/spanmetrics']?.exporters).toEqual([
        'clickhouse',
      ]);
    });
  });
});
