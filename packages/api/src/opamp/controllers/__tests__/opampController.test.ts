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

/**
 * Pipeline names declared under `service.pipelines:` in the bootstrap collector
 * config. Scanned rather than parsed because no YAML library is a dependency of
 * this package and the block is a handful of fixed-indent keys.
 */
const bootstrapPipelineNames = (yamlText: string): string[] => {
  const lines = yamlText.split('\n');
  const start = lines.indexOf('  pipelines:');
  if (start === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) break; // dedented out of the pipelines block
    if (indent !== 4) continue; // a key within a pipeline, e.g. `processors:`
    const match = /^([^:\s]+):$/.exec(trimmed);
    if (match) names.push(match[1]);
  }
  return names;
};

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
      // for type `spanmetrics`. The kind has to match the section the id was
      // declared in, not just any kind: `prometheus` is a real receiver, so an
      // OR across kinds would wave through an `exporters.prometheus` entry that
      // the build has no exporter for.
      const registers = (id: string, kind: string) =>
        builderConfig.includes(`/${baseType(id)}${kind}`);

      // The discrimination the loop below relies on: the build has a Prometheus
      // receiver but no Prometheus exporter.
      expect(registers('prometheus', 'receiver')).toBe(true);
      expect(registers('prometheus', 'exporter')).toBe(false);

      // Core components shipped in the collector binary rather than declared as
      // contrib gomods in builder-config.yaml.
      const CORE_COMPONENTS = ['nop', 'debug', 'memory_limiter', 'batch'];

      const declaredIds: Array<[string, string]> = [
        ...Object.keys(cfg.connectors ?? {}).map(
          id => [id, 'connector'] as [string, string],
        ),
        ...Object.keys(cfg.exporters ?? {}).map(
          id => [id, 'exporter'] as [string, string],
        ),
        ...Object.keys(cfg.receivers ?? {}).map(
          id => [id, 'receiver'] as [string, string],
        ),
      ];
      // Assert we actually looked at something — an empty set would make every
      // loop below vacuously green, which is how a bad type name shipped.
      expect(declaredIds.length).toBeGreaterThan(0);

      for (const [id, kind] of declaredIds) {
        if (CORE_COMPONENTS.includes(baseType(id))) continue;
        expect([id, registers(id, kind)]).toEqual([id, true]);
      }

      // Every pipeline reference must also resolve to a component this config
      // declares — a pipeline naming an undeclared id fails to decode too.
      const declared = new Set(declaredIds.map(([id]) => id));
      let pipelineRefs = 0;
      for (const pipeline of Object.values(cfg.service.pipelines)) {
        for (const id of [
          ...(pipeline?.receivers ?? []),
          ...(pipeline?.exporters ?? []),
        ]) {
          expect(declared).toContain(id);
          pipelineRefs++;
        }
      }
      expect(pipelineRefs).toBeGreaterThan(0);
    });

    // The supervisor merges the bootstrap config.yaml with the remote config
    // unconditionally, and the collector rejects a pipeline with no receivers or
    // no exporters ("must have at least one receiver") — failing the whole
    // config, not just that pipeline. So any pipeline key the bootstrap declares
    // has to be one the generated config always fills in. Declaring a
    // flag-gated pipeline there leaves the collector unable to start whenever
    // the flag is off, which is exactly the bug this pins.
    it.each([
      ['off', false],
      ['on', true],
    ])(
      'fills in every bootstrap-declared pipeline with span metrics %s',
      (_label, enabled) => {
        configState.IS_SPAN_METRICS_ENABLED = enabled;

        const bootstrapPipelines = bootstrapPipelineNames(
          readFileSync(
            resolve(
              __dirname,
              '../../../../../../docker/otel-collector/config.yaml',
            ),
            'utf8',
          ),
        );
        // An empty scan would make the loop below vacuously green.
        expect(bootstrapPipelines.length).toBeGreaterThan(0);

        const cfg = buildOtelCollectorConfig([
          { apiKey: 'k1', collectorAuthenticationEnforced: false },
        ]);

        for (const name of bootstrapPipelines) {
          const pipeline = cfg.service.pipelines[name];
          expect([name, pipeline?.receivers?.length ?? 0]).not.toEqual([
            name,
            0,
          ]);
          expect([name, pipeline?.exporters?.length ?? 0]).not.toEqual([
            name,
            0,
          ]);
        }
      },
    );

    it('keeps the derived series bounded', () => {
      configState.IS_SPAN_METRICS_ENABLED = true;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      // Temporality is cumulative, so nothing evicts a series once created.
      // Without a limit, one caller-supplied dimension (a tenant id, a raw
      // unparameterised path) grows collector memory and the ClickHouse write
      // volume without bound.
      expect(
        cfg.connectors?.spanmetrics?.aggregation_cardinality_limit,
      ).toBeGreaterThan(0);
      // The limit is per resource-cache entry, so it bounds nothing unless the
      // resource key is bounded too. Left at its default the key is every
      // resource attribute, and per-pod attributes would multiply the ceiling by
      // the cache size.
      expect(
        cfg.connectors?.spanmetrics?.resource_metrics_key_attributes,
      ).toEqual([
        'service.name',
        'service.namespace',
        'deployment.environment.name',
      ]);
      const dimensions = cfg.connectors?.spanmetrics?.dimensions.map(
        d => d.name,
      );
      expect(dimensions).toEqual([
        'http.route',
        'http.request.method',
        'http.response.status_code',
      ]);
    });

    it('omits the remote-write exporter when the endpoint is unset', () => {
      // config.ts derives IS_SPAN_METRICS_PROM_RW_ENABLED from the endpoint
      // being present, but the controller must not depend on that: an exporter
      // with no `endpoint` fails the whole config to decode, taking ingestion
      // down rather than just skipping this sink.
      configState.IS_SPAN_METRICS_ENABLED = true;
      configState.IS_SPAN_METRICS_PROM_RW_ENABLED = true;
      configState.SPAN_METRICS_PROM_RW_ENDPOINT = undefined;

      const cfg = buildOtelCollectorConfig([
        { apiKey: 'k1', collectorAuthenticationEnforced: false },
      ]);

      expect(
        cfg.exporters?.['prometheusremotewrite/spanmetrics'],
      ).toBeUndefined();
      expect(cfg.service.pipelines['metrics/spanmetrics']?.exporters).toEqual([
        'clickhouse',
      ]);
    });
  });
});
