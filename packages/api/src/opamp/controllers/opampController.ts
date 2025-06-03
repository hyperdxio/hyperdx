import { Request, Response } from 'express';

import * as config from '@/config';
import { getTeam } from '@/controllers/team';
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
  };
  service: {
    extensions: string[];
    pipelines: {
      [key: string]: {
        receivers: string[];
      };
    };
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
        const team = await getTeam();
        // This is later merged with otel-collector/config.yaml
        // we need to instantiate a valid config so the collector
        // can at least start up
        const NOP_CONFIG: CollectorConfig = {
          extensions: {},
          receivers: {
            nop: null,
          },
          service: {
            extensions: [],
            pipelines: {
              traces: {
                receivers: ['nop'],
              },
              metrics: {
                receivers: ['nop'],
              },
              'logs/in': {
                receivers: ['nop'],
              },
            },
          },
        };
        let otelCollectorConfig = NOP_CONFIG;

        // If team is not found, don't send a remoteConfig, we aren't ready
        // to collect telemetry yet
        if (team) {
          otelCollectorConfig = {
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
            service: {
              extensions: [],
              pipelines: {
                traces: {
                  receivers: ['otlp/hyperdx'],
                },
                metrics: {
                  receivers: ['otlp/hyperdx', 'prometheus'],
                },
                'logs/in': {
                  receivers: ['otlp/hyperdx', 'fluentforward'],
                },
              },
            },
          };

          if (team.collectorAuthenticationEnforced) {
            const ingestionKey = team.apiKey;

            if (otelCollectorConfig.receivers['otlp/hyperdx'] == null) {
              // should never happen
              throw new Error('otlp/hyperdx receiver not found');
            }

            otelCollectorConfig.extensions['bearertokenauth/hyperdx'] = {
              scheme: '',
              tokens: [ingestionKey],
            };
            otelCollectorConfig.receivers['otlp/hyperdx'].protocols.grpc.auth =
              {
                authenticator: 'bearertokenauth/hyperdx',
              };
            otelCollectorConfig.receivers['otlp/hyperdx'].protocols.http.auth =
              {
                authenticator: 'bearertokenauth/hyperdx',
              };
            otelCollectorConfig.extensions = ['bearertokenauth/hyperdx'];
          }
        }

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
