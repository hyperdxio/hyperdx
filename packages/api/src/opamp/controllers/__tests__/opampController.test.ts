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

import { readFileSync } from 'fs';
import { resolve } from 'path';

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
      expect(cfg.connectors?.spanmetrics).toBeUndefined();
      expect(cfg.service.pipelines['metrics/spanmetrics']).toBeUndefined();
      expect(cfg.service.pipelines.traces.exporters).not.toContain(
        'spanmetrics',
      );
    });

    it('derives span metrics as exponential histograms with exemplars', () => {
      configState.IS_SPAN_METRICS_ENABLED = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      // Exponential rather than explicit buckets: a fixed ladder's wide top
      // bucket makes high quantiles interpolate well past the slowest real
      // request, so no exemplar can ever sit on the plotted line.
      expect(cfg.connectors?.spanmetrics?.histogram).toEqual({
        unit: 'ms',
        exponential: { max_size: 160 },
      });
      expect(cfg.connectors?.spanmetrics?.exemplars).toEqual({
        enabled: true,
      });
      expect(cfg.service.pipelines['metrics/spanmetrics']?.exporters).toEqual([
        'clickhouse',
      ]);
      // The connector has to be wired at both ends or it silently does nothing.
      expect(cfg.service.pipelines.traces.exporters).toContain('spanmetrics');
      expect(cfg.service.pipelines['metrics/spanmetrics']?.receivers).toEqual([
        'spanmetrics',
      ]);
    });

    it('adds a remote-write exporter for the derived metrics when enabled', () => {
      configState.IS_SPAN_METRICS_ENABLED = true;
      configState.IS_SPAN_METRICS_PROM_RW_ENABLED = true;
      configState.SPAN_METRICS_PROM_RW_ENDPOINT =
        'http://prometheus:9090/api/v1/write';

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      expect(
        cfg.exporters?.['prometheusremotewrite/spanmetrics'],
      ).toMatchObject({ endpoint: 'http://prometheus:9090/api/v1/write' });
      expect(cfg.service.pipelines['metrics/spanmetrics']?.exporters).toEqual([
        'clickhouse',
        'prometheusremotewrite/spanmetrics',
      ]);
    });

    // A config naming a component type the binary doesn't register fails to
    // decode as a whole, and docker/otel-collector/config.yaml defines no
    // pipelines of its own — so a bad type name here leaves the collector with
    // no usable config at all rather than just disabling one feature. Pin every
    // generated component id against what builder-config.yaml actually builds.
    it('only references component types the collector build registers', () => {
      configState.IS_SPAN_METRICS_ENABLED = true;
      configState.IS_SPAN_METRICS_PROM_RW_ENABLED = true;
      configState.SPAN_METRICS_PROM_RW_ENDPOINT =
        'http://prometheus:9090/write';
      configState.IS_PROMQL_ENABLED = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      const builderConfig = readFileSync(
        resolve(__dirname, '../../../../../otel-collector/builder-config.yaml'),
        'utf8',
      );
      // `<type>/<name>` ids share the base type, which is what gets registered.
      const baseType = (id: string) => id.split('/')[0];
      // gomod lines end in `<type><kind>` — e.g. `.../connector/spanmetricsconnector`
      // for type `spanmetrics`. Matching the suffixed forms is what makes
      // `span_metrics` (the bug this test exists for) fail to resolve.
      const registers = (id: string) =>
        ['connector', 'exporter', 'receiver', 'processor'].some(kind =>
          builderConfig.includes(`/${baseType(id)}${kind}`),
        );

      // Core components shipped in the collector binary rather than declared as
      // contrib gomods in builder-config.yaml.
      const CORE_COMPONENTS = ['nop', 'debug', 'memory_limiter', 'batch'];

      const declaredIds = [
        ...Object.keys(cfg.connectors ?? {}),
        ...Object.keys(cfg.exporters ?? {}),
        ...Object.keys(cfg.receivers ?? {}),
      ];
      // Assert we actually looked at something — an empty set would make every
      // loop below vacuously green, which is how a bad type name shipped.
      expect(declaredIds.length).toBeGreaterThan(0);

      for (const id of declaredIds) {
        if (CORE_COMPONENTS.includes(baseType(id))) continue;
        expect(registers(id)).toBe(true);
      }

      // Every pipeline reference must resolve to a declared component. Processors
      // are included: they're named here but declared in
      // docker/otel-collector/config.yaml, so they can't be checked against the
      // declared set — but they still have to be types the build registers, since
      // an unregistered processor fails the whole config to decode just like an
      // unregistered connector.
      const declared = new Set(declaredIds);
      let pipelineRefs = 0;
      for (const pipeline of Object.values(cfg.service.pipelines)) {
        for (const id of [
          ...(pipeline?.receivers ?? []),
          ...(pipeline?.exporters ?? []),
        ]) {
          expect(declared).toContain(id);
          pipelineRefs++;
        }
        for (const id of pipeline?.processors ?? []) {
          if (CORE_COMPONENTS.includes(baseType(id))) continue;
          expect(registers(id)).toBe(true);
          pipelineRefs++;
        }
      }
      expect(pipelineRefs).toBeGreaterThan(0);
    });
  });
});
