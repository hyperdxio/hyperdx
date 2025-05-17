import { Request, Response } from 'express';

import { getTeam } from '@/controllers/team';
import logger from '@/utils/logger';

import { agentService } from '../services/agentService';
import {
  createRemoteConfig,
  decodeAgentToServer,
  encodeServerToAgent,
  serverCapabilities,
} from '../utils/protobuf';

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
        const config: {
          extensions: Record<string, any>;
          receivers: {
            'otlp/hyperdx': {
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
          };
          service: {
            extensions: string[];
          };
        } = {
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
          },
        };

        // If team is not found, don't send a remoteConfig, we aren't ready
        // to collect telemetry yet
        if (team) {
          if (team.collectorAuthenticationEnforced) {
            const ingestionKey = team.apiKey;

            config.extensions['bearertokenauth/hyperdx'] = {
              scheme: '',
              tokens: [ingestionKey],
            };
            config.receivers['otlp/hyperdx'].protocols.grpc.auth = {
              authenticator: 'bearertokenauth/hyperdx',
            };
            config.receivers['otlp/hyperdx'].protocols.http.auth = {
              authenticator: 'bearertokenauth/hyperdx',
            };
            config.service.extensions = ['bearertokenauth/hyperdx'];
          }

          const remoteConfig = createRemoteConfig(
            new Map([['config.yaml', Buffer.from(JSON.stringify(config))]]),
            'application/json',
          );

          serverToAgent.remoteConfig = remoteConfig;
          logger.debug(
            `Sending remote config to agent: ${agent.instanceUid.toString(
              'hex',
            )}`,
          );
        }
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
