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
        receivers?: string[];
        processors?: string[];
        exporters?: string[];
      };
    };
  };
};

export const buildOtelCollectorConfig = (teams: ITeam[]): CollectorConfig => {
  const apiKeys = teams.filter(team => team.apiKey).map(team => team.apiKey);
  const collectorAuthenticationEnforced =
    teams[0]?.collectorAuthenticationEnforced;

  if (apiKeys && apiKeys.length > 0) {
    // Build full configuration with all team API keys
    const otelCollectorConfig: CollectorConfig = {
      extensions: {},
      receivers: {
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
          ttl: '720h',
          logs_table_name: 'hyperdx_sessions',
          timeout: '5s',
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
          ttl: '720h',
          timeout: '5s',
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
            receivers: ['otlp/hyperdx'],
            processors: ['memory_limiter', 'batch'],
            exporters: ['clickhouse'],
          },
          metrics: {
            receivers: ['otlp/hyperdx', 'prometheus'],
            processors: ['memory_limiter', 'batch'],
            exporters: ['clickhouse'],
          },
          'logs/in': {
            receivers: ['otlp/hyperdx', 'fluentforward'],
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

    return otelCollectorConfig;
  }

  // If no apiKeys are found, return NOP config
  // This is later merged with otel-collector/config.yaml
  // we need to instantiate a valid config so the collector
  // can at least start up
  return {
    extensions: {},
    receivers: {
      nop: null,
    },
    connectors: {},
    exporters: {},
    service: {
      extensions: [],
      pipelines: {
        traces: {
          receivers: ['nop'],
        },
        metrics: {
          receivers: ['nop'],
        },
        logs: {
          receivers: ['nop'],
        },
      },
    },
  };
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
      logger.debug('agentToServer', agentToServer);
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
          console.log(JSON.stringify(otelCollectorConfig, null, 2));
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
      logger.error('Error handling OpAMP message:', error);
      res.status(500).send('Internal Server Error');
    }
  }
}

// Create a singleton instance
export const opampController = new OpampController();
