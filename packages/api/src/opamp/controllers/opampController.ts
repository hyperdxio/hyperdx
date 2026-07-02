import { Request, Response } from 'express';

import * as config from '@/config';
import { getAllTeams } from '@/controllers/team';
import type { ITeam } from '@/models/team';
import { agentService } from '@/opamp/services/agentService';
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
  connectors?: {
    'routing/logs'?: {
      default_pipelines: string[];
      error_mode: string;
      table: Array<{
        context: string;
        statement: string;
        pipelines: string[];
      }>;
    };
    span_metrics?: {
      histogram: { unit: string; explicit: { buckets: string[] } };
      dimensions: Array<{ name: string }>;
      exemplars: { enabled: boolean };
      metrics_flush_interval: string;
      namespace?: string;
    };
  };
  exporters?: {
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
    prometheusremotewrite?: {
      endpoint: string;
      tls: {
        insecure: boolean;
      };
      resource_to_telemetry_conversion: {
        enabled: boolean;
      };
    };
    'prometheusremotewrite/spanmetrics'?: {
      endpoint: string;
      tls: {
        insecure: boolean;
      };
      resource_to_telemetry_conversion: {
        enabled: boolean;
      };
    };
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

    if (config.IS_PROMQL_ENABLED && otelCollectorConfig.exporters) {
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

    if (
      config.IS_SPAN_METRICS_ENABLED &&
      otelCollectorConfig.connectors &&
      otelCollectorConfig.exporters
    ) {
      // Derive request metrics (with trace exemplars) from spans. The connector
      // consumes the traces pipeline and feeds a dedicated metrics pipeline, so
      // the resulting `traces.span.metrics.*` land in ClickHouse with
      // `Exemplars.*` pointing back at the spans they were measured from.
      otelCollectorConfig.connectors.span_metrics = {
        histogram: {
          unit: 'ms',
          explicit: {
            buckets: [
              '2ms',
              '5ms',
              '10ms',
              '25ms',
              '50ms',
              '100ms',
              '250ms',
              '500ms',
              '1s',
              '2.5s',
              '5s',
              '10s',
            ],
          },
        },
        dimensions: [
          { name: 'http.route' },
          { name: 'http.method' },
          { name: 'host.region' },
          { name: 'app.tenant_id' },
          { name: 'http.status_code' },
        ],
        exemplars: { enabled: true },
        metrics_flush_interval: '15s',
      };
      otelCollectorConfig.service.pipelines.traces.exporters.push(
        'span_metrics',
      );

      const spanMetricsExporters = ['clickhouse'];
      // Optionally also remote-write the derived metrics (with exemplars) to a
      // Prometheus endpoint, so the native Prometheus `query_exemplars` path can
      // be exercised against the same real, generated data.
      if (config.IS_SPAN_METRICS_PROM_RW_ENABLED) {
        otelCollectorConfig.exporters['prometheusremotewrite/spanmetrics'] = {
          // Guaranteed set by IS_SPAN_METRICS_PROM_RW_ENABLED above.
          endpoint: config.SPAN_METRICS_PROM_RW_ENDPOINT!,
          tls: { insecure: true },
          resource_to_telemetry_conversion: { enabled: true },
        };
        spanMetricsExporters.push('prometheusremotewrite/spanmetrics');
      }
      otelCollectorConfig.service.pipelines['metrics/spanmetrics'] = {
        receivers: ['span_metrics'],
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

          // Decode the AgentToServer message
          const agentToServer = decodeAgentToServer(req.body);
          logger.debug({ agentToServer }, 'agentToServer');
          logger.debug(
            // @ts-ignore
            `Received message from agent: ${agentToServer.instanceUid?.toString(
              'hex',
            )}`,
          );

          // Process the agent status
          const agent = agentService.processAgentStatus(agentToServer);

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

          // Check if we should send a remote configuration
          if (acceptsRemoteConfig) {
            const teams = await getAllTeams([
              'apiKey',
              'collectorAuthenticationEnforced',
            ]);
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
            opampRemoteConfigsCounter.add(1);
            logger.debug(
              `Sending remote config to agent: ${agent.instanceUid.toString(
                'hex',
              )}`,
            );
          }

          // Encode and send the response
          const encodedResponse = encodeServerToAgent(serverToAgent);

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
