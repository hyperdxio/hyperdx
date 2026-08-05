import { Request, Response } from 'express';

import * as config from '@/config';
import { getAllTeams } from '@/controllers/team';
import type { ITeam } from '@/models/team';
import { agentService } from '@/opamp/services/agentService';
import {
  decodeAgentCapabilities,
  getAgentAttribute,
  remoteConfigStatusName,
  toSafeNumber,
  truncateAttr,
} from '@/opamp/utils/agentTelemetry';
import {
  createRemoteConfig,
  decodeAgentToServer,
  encodeServerToAgent,
  serverCapabilities,
} from '@/opamp/utils/protobuf';
import {
  getCounter,
  SpanKind,
  SpanStatusCode,
  withSpan,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

// OTel resource keys from the agent's AgentDescription that we surface as span
// attributes, so a single trace can be sliced by collector version, OS, etc.
const AGENT_DESCRIPTION_SPAN_ATTRS: ReadonlyArray<readonly [string, string]> = [
  ['opamp.agent.service_name', 'service.name'],
  ['opamp.agent.service_version', 'service.version'],
  ['opamp.agent.os_type', 'os.type'],
  ['opamp.agent.host_arch', 'host.arch'],
];

// OpAMP messages come from collector agents, not authenticated users, so there
// is no team/user context to attach. We instead track delivery outcomes with a
// low-cardinality `outcome` enum (see agent_docs/observability.md).
const opampMessagesCounter = getCounter('hyperdx.opamp.messages', {
  description:
    'Count of OpAMP AgentToServer messages handled, labeled by outcome (processed, unsupported_media_type, error).',
});
const opampRemoteConfigsCounter = getCounter('hyperdx.opamp.remote_configs', {
  description:
    'Count of OpAMP remote collector configs sent back to agents in a ServerToAgent response.',
});

type PrometheusRemoteWriteExporter = {
  endpoint: string;
  resource_to_telemetry_conversion: {
    enabled: boolean;
  };
};

type CollectorConfig = {
  extensions: Record<string, any>;
  receivers: {
    'otlp/hyperdx'?: {
      protocols: {
        grpc: {
          endpoint: string;
          include_metadata: boolean;
          auth?: {
            authenticator: string;
          };
        };
        http: {
          endpoint: string;
          cors: {
            allowed_origins: string[];
            allowed_headers: string[];
          };
          include_metadata: boolean;
          auth?: {
            authenticator: string;
          };
        };
      };
    };
    prometheus?: {
      config: {
        scrape_configs: Array<{
          job_name: string;
          scrape_interval: string;
          static_configs: Array<{
            targets: string[];
          }>;
        }>;
      };
    };
    fluentforward?: {
      endpoint: string;
    };
    nop?: null;
    'routing/logs'?: string[];
    datadog?: {
      endpoint: string;
      read_timeout: string;
      auth?: {
        authenticator: string;
      };
    };
  };
  // Always constructed below, so the blocks that extend them can index
  // without narrowing.
  connectors: {
    'routing/logs'?: {
      default_pipelines: string[];
      error_mode: string;
      table: Array<{
        context: string;
        statement: string;
        pipelines: string[];
      }>;
    };
    spanmetrics?: {
      histogram: { unit: string; exponential: { max_size: number } };
      dimensions: Array<{ name: string }>;
      exemplars: { enabled: boolean };
      metrics_flush_interval: string;
      resource_metrics_key_attributes: string[];
      aggregation_cardinality_limit: number;
    };
  };
  exporters: {
    nop?: null;
    debug?: {
      verbosity: string;
      sampling_initial: number;
      sampling_thereafter: number;
    };
    'clickhouse/rrweb'?: {
      endpoint: string;
      database: string;
      username: string;
      password: string;
      ttl: string;
      logs_table_name: string;
      timeout: string;
      create_schema: string;
      json: string;
      retry_on_failure: {
        enabled: boolean;
        initial_interval: string;
        max_interval: string;
        max_elapsed_time: string;
      };
    };
    clickhouse?: {
      endpoint: string;
      database: string;
      username: string;
      password: string;
      ttl: string;
      timeout: string;
      create_schema: string;
      json: string;
      retry_on_failure: {
        enabled: boolean;
        initial_interval: string;
        max_interval: string;
        max_elapsed_time: string;
      };
    };
    prometheusremotewrite?: PrometheusRemoteWriteExporter & {
      tls: { insecure: boolean };
    };
    // No `tls` block. On an HTTP exporter the URL scheme decides whether TLS is
    // used and verification is on by default; `insecure` only means anything to
    // gRPC transports, so it is inert on the exporter above rather than
    // weakening it. Omitted here so nobody reads it as a knob that does.
    'prometheusremotewrite/spanmetrics'?: PrometheusRemoteWriteExporter;
  };
  service: {
    extensions: string[];
    pipelines: {
      [key: string]: {
        receivers: string[];
        processors?: string[];
        exporters: string[];
      };
    };
  };
};

export const buildOtelCollectorConfig = (
  teams: Pick<ITeam, 'apiKey' | 'collectorAuthenticationEnforced'>[],
): CollectorConfig => {
  const apiKeys = teams.filter(team => team.apiKey).map(team => team.apiKey);

  if (config.IS_ALL_IN_ONE_IMAGE || config.IS_LOCAL_APP_MODE || config.IS_DEV) {
    // Only allow INGESTION_API_KEY for dev or all-in-one images for security reasons
    if (config.INGESTION_API_KEY) {
      apiKeys.push(config.INGESTION_API_KEY);
    }
  }

  const collectorAuthenticationEnforced =
    teams[0]?.collectorAuthenticationEnforced;

  const otelCollectorConfig: CollectorConfig = {
    extensions: {},
    receivers: {
      nop: null,
      'otlp/hyperdx': {
        protocols: {
          grpc: {
            endpoint: '0.0.0.0:4317',
            include_metadata: true,
          },
          http: {
            endpoint: '0.0.0.0:4318',
            cors: {
              allowed_origins: ['*'],
              allowed_headers: ['*'],
            },
            include_metadata: true,
          },
        },
      },
      prometheus: {
        config: {
          scrape_configs: [
            {
              job_name: 'otelcol',
              scrape_interval: '30s',
              static_configs: [
                {
                  targets: [
                    '0.0.0.0:8888',
                    '${env:CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT}',
                  ],
                },
              ],
            },
          ],
        },
      },
      fluentforward: {
        endpoint: '0.0.0.0:24225',
      },
    },
    connectors: {
      'routing/logs': {
        default_pipelines: ['logs/out-default'],
        error_mode: 'ignore',
        table: [
          {
            context: 'log',
            statement:
              'route() where IsMatch(attributes["rr-web.event"], ".*")',
            pipelines: ['logs/out-rrweb'],
          },
        ],
      },
    },
    exporters: {
      nop: null,
      debug: {
        verbosity: 'detailed',
        sampling_initial: 5,
        sampling_thereafter: 200,
      },
      'clickhouse/rrweb': {
        endpoint: '${env:CLICKHOUSE_ENDPOINT}',
        database: '${env:HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE}',
        username: '${env:CLICKHOUSE_USER}',
        password: '${env:CLICKHOUSE_PASSWORD}',
        ttl: '${env:HYPERDX_OTEL_EXPORTER_TABLES_TTL:-720h}',
        logs_table_name: 'hyperdx_sessions',
        timeout: '5s',
        create_schema:
          '${env:HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA:-false}',
        json: '${env:HYPERDX_OTEL_EXPORTER_CLICKHOUSE_JSON_ENABLE:-false}',
        retry_on_failure: {
          enabled: true,
          initial_interval: '5s',
          max_interval: '30s',
          max_elapsed_time: '300s',
        },
      },
      clickhouse: {
        endpoint: '${env:CLICKHOUSE_ENDPOINT}',
        database: '${env:HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE}',
        username: '${env:CLICKHOUSE_USER}',
        password: '${env:CLICKHOUSE_PASSWORD}',
        ttl: '${env:HYPERDX_OTEL_EXPORTER_TABLES_TTL:-720h}',
        timeout: '5s',
        create_schema:
          '${env:HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA:-false}',
        json: '${env:HYPERDX_OTEL_EXPORTER_CLICKHOUSE_JSON_ENABLE:-false}',
        retry_on_failure: {
          enabled: true,
          initial_interval: '5s',
          max_interval: '30s',
          max_elapsed_time: '300s',
        },
      },
    },
    service: {
      extensions: [],
      // The pipeline `processors:` lists are intentionally declared in the
      // bootstrap config (docker/otel-collector/config.yaml) instead of here,
      // so that users can swap them via CUSTOM_OTELCOL_CONFIG_FILE. See
      // https://github.com/hyperdxio/hyperdx/pull/2351: when the OpAMP
      // remote config sets `processors:` on a pipeline, it overwrites the
      // bootstrap+custom merge, which prevents users from substituting
      // their own processor (e.g. a memory_limiter with limit_percentage
      // instead of limit_mib).
      pipelines: {
        traces: {
          receivers: ['nop'],
          exporters: ['clickhouse'],
        },
        metrics: {
          // TODO: prometheus needs to be authenticated
          receivers: ['prometheus'],
          exporters: ['clickhouse'],
        },
        'logs/in': {
          // TODO: fluentforward needs to be authenticated
          receivers: ['fluentforward'],
          exporters: ['routing/logs'],
        },
        'logs/out-default': {
          receivers: ['routing/logs'],
          exporters: ['clickhouse'],
        },
        'logs/out-rrweb': {
          receivers: ['routing/logs'],
          exporters: ['clickhouse/rrweb'],
        },
      },
    },
  };
  if (apiKeys && apiKeys.length > 0) {
    // attach otlp/hyperdx receiver
    otelCollectorConfig.service.pipelines.traces.receivers.push('otlp/hyperdx');
    otelCollectorConfig.service.pipelines.metrics.receivers.push(
      'otlp/hyperdx',
    );
    otelCollectorConfig.service.pipelines['logs/in'].receivers.push(
      'otlp/hyperdx',
    );

    if (config.IS_PROMQL_ENABLED) {
      otelCollectorConfig.exporters.prometheusremotewrite = {
        endpoint: 'http://${env:CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT}/write',
        tls: {
          insecure: true,
        },
        resource_to_telemetry_conversion: {
          enabled: true,
        },
      };
      otelCollectorConfig.service.pipelines['metrics/promql'] = {
        receivers: ['otlp/hyperdx'],
        processors: ['memory_limiter', 'batch'],
        exporters: ['prometheusremotewrite'],
      };
    }

    if (config.IS_SPAN_METRICS_ENABLED) {
      // Derive request metrics (with trace exemplars) from spans. The connector
      // consumes the traces pipeline and feeds a dedicated metrics pipeline, so
      // the resulting `traces.span.metrics.*` land in ClickHouse with
      // `Exemplars.*` pointing back at the spans they were measured from.
      //
      // The key MUST be `spanmetrics` — that is the component type
      // spanmetricsconnector registers, and a config naming an unregistered type
      // fails to decode wholesale. Because docker/otel-collector/config.yaml
      // supplies no pipelines of its own, a rejected remote config leaves the
      // collector with nothing to run, so a typo here takes ingestion down
      // rather than just disabling this feature.
      //
      // Requires a collector built from the current builder-config.yaml (which
      // added spanmetricsconnector). Enabling this flag against collectors built
      // before that will have them reject the config for the same reason, so
      // roll the collector image out first.
      otelCollectorConfig.connectors.spanmetrics = {
        histogram: {
          unit: 'ms',
          // Exponential (OTLP) / native (Prometheus) buckets rather than a fixed
          // ladder. Explicit bounds put everything slow into one wide top bucket
          // — with a 5s–10s bucket, a p99 interpolates towards 10s while the
          // slowest real request was half that, and no exemplar can ever sit on
          // the line. max_size is the connector's default; scale adapts to the
          // observed range, giving sub-percent quantile error at any latency.
          exponential: { max_size: 160 },
        },
        // Stable HTTP semconv names — `http.method`/`http.status_code` are the
        // pre-1.23 spellings and are absent from current SDKs. Every dimension
        // here is bounded by the application's own route table or by the HTTP
        // spec; free-form or caller-supplied attributes (a tenant id, a raw
        // unparameterised path) are deliberately excluded, because each distinct
        // combination is a separate series held in collector memory and written
        // to ClickHouse on every flush.
        //
        // The connector always adds `service.name`, `span.name`, `span.kind` and
        // `status.code` on top of these, and they cannot be turned off. Of those
        // `span.name` is the one the instrumentation controls, so an SDK that
        // puts raw paths or ids in span names widens the label set regardless of
        // what is listed here.
        dimensions: [
          { name: 'http.route' },
          { name: 'http.request.method' },
          { name: 'http.response.status_code' },
        ],
        exemplars: { enabled: true },
        metrics_flush_interval: '15s',
        // Backstop for the above: temporality is cumulative, so series are never
        // evicted on their own. Past this many, the connector folds further
        // combinations into an overflow series rather than growing without
        // bound.
        //
        // The limit applies per entry in the resource cache, not globally, so it
        // only bounds anything if the resource key is itself bounded. By default
        // that key is every resource attribute — including per-pod and
        // per-process ones — which would make the real ceiling
        // resource_metrics_cache_size (1000) x this limit. Keying on the service
        // instead keeps one aggregation per service, and stops counters resetting
        // when a pod restarts and its resource key changes.
        resource_metrics_key_attributes: [
          'service.name',
          'service.namespace',
          'deployment.environment.name',
        ],
        aggregation_cardinality_limit: 10_000,
      };
      // A connector runs inline in the pipeline fan-out rather than behind
      // exporterhelper's queue and retry, so unlike the clickhouse exporter
      // beside it there is nothing decoupling it from trace ingestion — time
      // spent aggregating is time the traces pipeline waits. That is inherent to
      // connectors; it is the reason the dimensions above are kept small.
      otelCollectorConfig.service.pipelines.traces.exporters.push(
        'spanmetrics',
      );

      const spanMetricsExporters = ['clickhouse'];
      // Optionally also remote-write the derived metrics (with exemplars) to a
      // Prometheus endpoint, so the native Prometheus `query_exemplars` path can
      // be exercised against the same real, generated data.
      //
      // Keyed off the endpoint rather than the flag alone: an exporter with no
      // `endpoint` fails the whole config to decode, which would take ingestion
      // down (see the connector comment above) over an optional extra sink.
      const spanMetricsRemoteWriteEndpoint =
        config.IS_SPAN_METRICS_PROM_RW_ENABLED
          ? config.SPAN_METRICS_PROM_RW_ENDPOINT
          : undefined;
      if (spanMetricsRemoteWriteEndpoint) {
        otelCollectorConfig.exporters['prometheusremotewrite/spanmetrics'] = {
          endpoint: spanMetricsRemoteWriteEndpoint,
          // Off, unlike the promql exporter above: that one writes to our own
          // ClickHouse-backed Prometheus, whereas this endpoint is a third party.
          // Promoting every resource attribute to a label would egress host, pod
          // and namespace there, and it happens in the exporter — after, and so
          // unbounded by, the connector's aggregation_cardinality_limit.
          resource_to_telemetry_conversion: { enabled: false },
        };
        spanMetricsExporters.push('prometheusremotewrite/spanmetrics');
      }
      // Sets `processors:` even though the comment on `pipelines` above says the
      // remote config should not, which costs CUSTOM_OTELCOL_CONFIG_FILE
      // overrides for this one pipeline (as `metrics/promql` already does). The
      // alternative — declaring them in the bootstrap config — is worse: this
      // pipeline only exists when the flag is on, so the bootstrap would be left
      // holding a pipeline with no receivers and no exporters, which fails
      // collector validation outright and stops the agent starting at all.
      otelCollectorConfig.service.pipelines['metrics/spanmetrics'] = {
        receivers: ['spanmetrics'],
        processors: ['memory_limiter', 'batch'],
        exporters: spanMetricsExporters,
      };
    }

    if (collectorAuthenticationEnforced) {
      if (otelCollectorConfig.receivers['otlp/hyperdx'] == null) {
        // should never happen
        throw new Error('otlp/hyperdx receiver not found');
      }

      otelCollectorConfig.extensions['bearertokenauth/hyperdx'] = {
        scheme: '',
        tokens: apiKeys,
      };
      otelCollectorConfig.receivers['otlp/hyperdx'].protocols.grpc.auth = {
        authenticator: 'bearertokenauth/hyperdx',
      };
      otelCollectorConfig.receivers['otlp/hyperdx'].protocols.http.auth = {
        authenticator: 'bearertokenauth/hyperdx',
      };
      otelCollectorConfig.service.extensions = ['bearertokenauth/hyperdx'];
    }
  }

  // Opt-in Datadog receiver: lets a Datadog Agent ship traces, metrics, and
  // logs to HyperDX. The contrib `datadogreceiver` runs a single HTTP server
  // (the DD intake API on :8126) that serves all three signals and translates
  // them into OTLP, which then flow through the existing traces/metrics/logs
  // pipelines to ClickHouse. It is gated behind ENABLE_DATADOG_RECEIVER
  // because it opens an extra ingest port (:8126).
  if (config.ENABLE_DATADOG_RECEIVER) {
    otelCollectorConfig.receivers.datadog = {
      endpoint: '0.0.0.0:8126',
      read_timeout: '60s',
    };
    otelCollectorConfig.service.pipelines.traces.receivers.push('datadog');
    otelCollectorConfig.service.pipelines.metrics.receivers.push('datadog');
    otelCollectorConfig.service.pipelines['logs/in'].receivers.push('datadog');

    // Authenticate Datadog agents with the same per-team API keys as
    // otlp/hyperdx. DD agents send their key in the `DD-API-KEY` header
    // (set via DD_API_KEY on the agent), so the bearer-token extension is
    // configured to validate that header instead of `Authorization`. Only
    // attached when team API keys exist and collector authentication is
    // enforced, mirroring otlp/hyperdx — otherwise the receiver stays
    // unauthenticated.
    if (apiKeys && apiKeys.length > 0 && collectorAuthenticationEnforced) {
      otelCollectorConfig.extensions['bearertokenauth/datadog'] = {
        header: 'DD-API-KEY',
        scheme: '',
        tokens: apiKeys,
      };
      otelCollectorConfig.receivers.datadog.auth = {
        authenticator: 'bearertokenauth/datadog',
      };
      otelCollectorConfig.service.extensions.push('bearertokenauth/datadog');
    }
  }

  return otelCollectorConfig;
};

export class OpampController {
  /**
   * Handle an OpAMP message from an agent
   */
  public async handleOpampMessage(req: Request, res: Response): Promise<void> {
    return withSpan(
      'opamp.handle_message',
      async span => {
        try {
          // Check content type
          const contentType = req.get('Content-Type');
          if (contentType !== 'application/x-protobuf') {
            opampMessagesCounter.add(1, { outcome: 'unsupported_media_type' });
            span.setStatus({ code: SpanStatusCode.OK });
            res
              .status(415)
              .send(
                'Unsupported Media Type: Content-Type must be application/x-protobuf',
              );
            return;
          }

          if (Buffer.isBuffer(req.body)) {
            span.setAttribute('opamp.request.body_size_bytes', req.body.length);
          }

          // Decode the AgentToServer message. The decoded protobuf is loosely
          // typed (a generic Message), so field access is via `any` here — the
          // same way processAgentStatus consumes it below.
          const agentToServer = decodeAgentToServer(req.body) as any;
          logger.debug({ agentToServer }, 'agentToServer');
          logger.debug(
            `Received message from agent: ${agentToServer.instanceUid?.toString(
              'hex',
            )}`,
          );

          // instanceUid is the OpAMP correlation key — high-cardinality, so it
          // belongs on the span (not a metric) to pin a trace to one agent.
          span.setAttribute(
            'opamp.agent.instance_uid',
            agentToServer.instanceUid?.toString('hex') ?? 'unknown',
          );
          // sequenceNum is a uint64 — decodes to a Long, not a number.
          const sequenceNum = toSafeNumber(agentToServer.sequenceNum);
          if (sequenceNum != null) {
            span.setAttribute('opamp.agent.sequence_num', sequenceNum);
          }

          // Health is reported on the message but not persisted on the agent
          // record, so read it straight off the decoded message.
          const health = agentToServer.health;
          if (health) {
            if (typeof health.healthy === 'boolean') {
              span.setAttribute('opamp.agent.healthy', health.healthy);
            }
            if (health.lastError) {
              span.setAttribute(
                'opamp.agent.health_last_error',
                truncateAttr(String(health.lastError)),
              );
            }
            if (health.status) {
              span.setAttribute(
                'opamp.agent.health_status',
                truncateAttr(String(health.status)),
              );
            }
            const startNano = toSafeNumber(health.startTimeUnixNano);
            if (startNano && startNano > 0) {
              span.setAttribute(
                'opamp.agent.uptime_ms',
                Math.max(0, Math.round(Date.now() - startNano / 1e6)),
              );
            }
          }

          // Process the agent status
          const agent = agentService.processAgentStatus(agentToServer);

          // capabilities is a uint64 → decodes to a Long; coerce so the OTel
          // SDK accepts it (a raw Long would be silently dropped).
          const capabilities = toSafeNumber(agent.capabilities);
          if (capabilities != null) {
            span.setAttribute('opamp.agent.capabilities', capabilities);
          }
          const capabilityFlags = decodeAgentCapabilities(agent.capabilities);
          if (capabilityFlags.length > 0) {
            span.setAttribute(
              'opamp.agent.capability_flags',
              capabilityFlags.join(','),
            );
          }

          // Flatten a curated subset of the agent's self-description onto the
          // span — these are the dimensions incidents get sliced by.
          const descriptionAttributes = [
            ...(agent.agentDescription?.identifyingAttributes ?? []),
            ...(agent.agentDescription?.nonIdentifyingAttributes ?? []),
          ];
          for (const [spanKey, otelKey] of AGENT_DESCRIPTION_SPAN_ATTRS) {
            const value = getAgentAttribute(descriptionAttributes, otelKey);
            if (value != null) {
              // Description values are agent-supplied; cap the string ones.
              span.setAttribute(
                spanKey,
                typeof value === 'string' ? truncateAttr(value) : value,
              );
            }
          }

          // status is an enum decoded to its raw numeric value; map to a bounded
          // name (see remoteConfigStatusName). The apply-outcome counter lives in
          // the service, where the previous status is available to detect a real
          // transition rather than counting every heartbeat.
          const remoteConfigStatus = remoteConfigStatusName(
            agent.remoteConfigStatus?.status,
          );
          if (remoteConfigStatus) {
            span.setAttribute(
              'opamp.agent.remote_config_status',
              remoteConfigStatus,
            );
          }
          if (agent.remoteConfigStatus?.errorMessage) {
            span.setAttribute(
              'opamp.agent.remote_config_error',
              truncateAttr(agent.remoteConfigStatus.errorMessage),
            );
          }
          // The config the agent last applied — compared against the hash we
          // send below, a mismatch means the agent has not yet converged.
          if (agent.remoteConfigStatus?.lastRemoteConfigHash) {
            span.setAttribute(
              'opamp.agent.last_remote_config_hash',
              agent.remoteConfigStatus.lastRemoteConfigHash.toString('hex'),
            );
          }

          const effectiveConfigMap = agent.effectiveConfig?.configMap;
          if (effectiveConfigMap) {
            span.setAttribute('opamp.agent.reports_effective_config', true);
            span.setAttribute(
              'opamp.agent.effective_config.size_bytes',
              Object.values(effectiveConfigMap).reduce(
                (sum, entry) => sum + (entry?.body?.length ?? 0),
                0,
              ),
            );
          }

          // Prepare the response
          const serverToAgent: any = {
            instanceUid: agent.instanceUid,
            capabilities: serverCapabilities,
          };

          const acceptsRemoteConfig =
            agentService.agentAcceptsRemoteConfig(agent);
          span.setAttribute(
            'opamp.agent.accepts_remote_config',
            acceptsRemoteConfig,
          );
          span.setAttribute('opamp.remote_config.sent', false);

          // Check if we should send a remote configuration
          if (acceptsRemoteConfig) {
            const teams = await getAllTeams([
              'apiKey',
              'collectorAuthenticationEnforced',
            ]);
            span.setAttribute('opamp.teams.count', teams.length);
            const otelCollectorConfig = buildOtelCollectorConfig(teams);

            if (config.IS_DEV) {
              logger.debug(JSON.stringify(otelCollectorConfig, null, 2));
            }

            const remoteConfig = createRemoteConfig(
              new Map([
                [
                  'config.json',
                  Buffer.from(JSON.stringify(otelCollectorConfig)),
                ],
              ]),
              'application/json',
            );

            serverToAgent.remoteConfig = remoteConfig;
            span.setAttribute('opamp.remote_config.sent', true);
            if (remoteConfig.configHash) {
              span.setAttribute(
                'opamp.remote_config.hash',
                Buffer.from(remoteConfig.configHash).toString('hex'),
              );
            }
            opampRemoteConfigsCounter.add(1);
            logger.debug(
              `Sending remote config to agent: ${agent.instanceUid.toString(
                'hex',
              )}`,
            );
          }

          // Encode and send the response
          const encodedResponse = encodeServerToAgent(serverToAgent);
          span.setAttribute(
            'opamp.response.size_bytes',
            encodedResponse.length,
          );

          opampMessagesCounter.add(1, { outcome: 'processed' });
          span.setStatus({ code: SpanStatusCode.OK });
          res.setHeader('Content-Type', 'application/x-protobuf');
          res.send(encodedResponse);
        } catch (error) {
          opampMessagesCounter.add(1, { outcome: 'error' });
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          logger.error({ err: error }, 'Error handling OpAMP message');
          res.status(500).send('Internal Server Error');
        }
      },
      { kind: SpanKind.INTERNAL, recordOkStatus: false },
    );
  }
}

// Create a singleton instance
export const opampController = new OpampController();
