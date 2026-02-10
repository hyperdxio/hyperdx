import { Request, Response } from 'express';

import * as config from '@/config';
import { getAllTeams } from '@/controllers/team';
import type { ITeam } from '@/models/team';
import logger from '@/utils/logger';

import { agentService } from '../services/agentService';
import {
  createRemoteConfig,
  decodeAgentToServer,
  encodeServerToAgent,
  serverCapabilities,
} from '../utils/protobuf';

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
      retry_on_failure: {
        enabled: boolean;
        initial_interval: string;
        max_interval: string;
        max_elapsed_time: string;
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

export const buildOtelCollectorConfig = (teams: ITeam[]): CollectorConfig => {
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
      pipelines: {
        traces: {
          receivers: ['nop'],
          processors: ['memory_limiter', 'batch'],
          exporters: ['clickhouse'],
        },
        metrics: {
          // TODO: prometheus needs to be authenticated
          receivers: ['prometheus'],
          processors: ['memory_limiter', 'batch'],
          exporters: ['clickhouse'],
        },
        'logs/in': {
          // TODO: fluentforward needs to be authenticated
          receivers: ['fluentforward'],
          exporters: ['routing/logs'],
        },
        'logs/out-default': {
          receivers: ['routing/logs'],
          processors: ['memory_limiter', 'transform', 'batch'],
          exporters: ['clickhouse'],
        },
        'logs/out-rrweb': {
          receivers: ['routing/logs'],
          processors: ['memory_limiter', 'batch'],
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

  return otelCollectorConfig;
};

export class OpampController {
  /**
   * Handle an OpAMP message from an agent
   */
  public async handleOpampMessage(req: Request, res: Response): Promise<void> {
    try {
      // Check content type
      const contentType = req.get('Content-Type');
      if (contentType !== 'application/x-protobuf') {
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

      // Check if we should send a remote configuration
      if (agentService.agentAcceptsRemoteConfig(agent)) {
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
            ['config.json', Buffer.from(JSON.stringify(otelCollectorConfig))],
          ]),
          'application/json',
        );

        serverToAgent.remoteConfig = remoteConfig;
        logger.debug(
          `Sending remote config to agent: ${agent.instanceUid.toString(
            'hex',
          )}`,
        );
      }

      // Encode and send the response
      const encodedResponse = encodeServerToAgent(serverToAgent);

      res.setHeader('Content-Type', 'application/x-protobuf');
      res.send(encodedResponse);
    } catch (error) {
      logger.error({ err: error }, 'Error handling OpAMP message');
      res.status(500).send('Internal Server Error');
    }
  }
}

// Create a singleton instance
export const opampController = new OpampController();
