import logger from '@/utils/logger';

import { Agent, agentStore } from '../models/agent';

export class AgentService {
  /**
   * Process an agent status report
   */
  public processAgentStatus(agentToServer: any): Agent {
    try {
      // Extract necessary fields from the message
      const {
        instanceUid,
        sequenceNum,
        agentDescription,
        capabilities,
        effectiveConfig,
        remoteConfigStatus,
      } = agentToServer;

      // Get the existing agent or create a new one
      let agent = agentStore.getAgent(instanceUid);

      if (!agent) {
        // New agent, create a new record
        agent = {
          instanceUid,
          sequenceNum,
          agentDescription,
          capabilities,
          effectiveConfig,
          remoteConfigStatus,
          lastSeen: new Date(),
        };
      } else {
        // Existing agent, update its record
        agent = {
          ...agent,
          sequenceNum,
          lastSeen: new Date(),
        };

        // Update optional fields if they exist in the message
        if (agentDescription) {
          agent.agentDescription = agentDescription;
        }

        if (capabilities) {
          agent.capabilities = capabilities;
        }

        if (effectiveConfig) {
          agent.effectiveConfig = effectiveConfig;
        }

        if (remoteConfigStatus) {
          agent.remoteConfigStatus = remoteConfigStatus;
        }
      }

      // Update the agent in the store
      agentStore.upsertAgent(agent);

      return agent;
    } catch (error) {
      logger.error({ err: error }, 'Error processing agent status');
      throw error;
    }
  }

  /**
   * Check if an agent accepts remote configuration
   */
  public agentAcceptsRemoteConfig(agent: Agent): boolean {
    // Check if the agent has the AcceptsRemoteConfig capability bit set
    // AcceptsRemoteConfig = 0x00000002
    return (agent.capabilities & 0x00000002) !== 0;
  }

  /**
   * Get an agent by its instance UID
   */
  public getAgent(instanceUid: Buffer): Agent | undefined {
    return agentStore.getAgent(instanceUid);
  }

  /**
   * Get all registered agents
   */
  public getAllAgents(): Agent[] {
    return agentStore.getAllAgents();
  }
}

// Create a singleton instance of the agent service
export const agentService = new AgentService();
