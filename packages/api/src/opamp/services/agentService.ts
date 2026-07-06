import { trace } from '@opentelemetry/api';

import { Agent, agentStore } from '@/opamp/models/agent';
import { toSafeNumber } from '@/opamp/utils/agentTelemetry';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

// Tracks whether a status report came from an agent we had not seen before
// (`new`) or an existing one (`updated`). Low-cardinality enum, safe as a
// metric attribute (see agent_docs/observability.md).
const agentStatusCounter = getCounter('hyperdx.opamp.agent_status_reports', {
  description:
    'Count of processed OpAMP agent status reports, labeled by status (new, updated).',
});

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
      const isNewAgent = !agent;
      const previousSequenceNum = agent?.sequenceNum;

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

      agentStatusCounter.add(1, { status: isNewAgent ? 'new' : 'updated' });
      // Surface new-vs-existing on the active handler span too, so a single
      // trace shows whether this was a first-contact report.
      const activeSpan = trace.getActiveSpan();
      activeSpan?.setAttribute('opamp.agent.is_new', isNewAgent);
      // Sequence numbers increment by 1 per message; a gap != 1 flags a missed
      // report or an agent restart.
      if (!isNewAgent) {
        const prev = toSafeNumber(previousSequenceNum);
        const curr = toSafeNumber(sequenceNum);
        if (prev != null && curr != null) {
          activeSpan?.setAttribute('opamp.agent.sequence_gap', curr - prev);
        }
      }

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
