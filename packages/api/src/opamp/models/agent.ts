export interface AgentAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: AgentAttribute[];
    kvlistValue?: AgentAttribute[];
    bytesValue?: Buffer;
  };
}

export interface AgentDescription {
  identifyingAttributes: AgentAttribute[];
  nonIdentifyingAttributes: AgentAttribute[];
}

export interface RemoteConfigStatus {
  lastRemoteConfigHash?: Buffer;
  status: 'UNSET' | 'APPLIED' | 'APPLYING' | 'FAILED';
  errorMessage?: string;
}

export interface EffectiveConfig {
  configMap: {
    [key: string]: {
      body: Buffer;
      contentType: string;
    };
  };
}

export interface Agent {
  instanceUid: Buffer;
  sequenceNum: number;
  agentDescription?: AgentDescription;
  capabilities: number;
  effectiveConfig?: EffectiveConfig;
  remoteConfigStatus?: RemoteConfigStatus;
  lastSeen: Date;
  currentConfigHash?: Buffer;
}

// TODO: Evaluate if we need to store agent state here at all
export class AgentStore {
  private agents: Map<string, Agent> = new Map();

  /**
   * Add or update an agent in the store
   */
  public upsertAgent(agent: Agent): void {
    const instanceUidStr = this.bufferToHex(agent.instanceUid);
    this.agents.set(instanceUidStr, {
      ...agent,
      lastSeen: new Date(),
    });
  }

  /**
   * Get an agent by its instance UID
   */
  public getAgent(instanceUid: Buffer): Agent | undefined {
    const instanceUidStr = this.bufferToHex(instanceUid);
    return this.agents.get(instanceUidStr);
  }

  /**
   * Get all agents in the store
   */
  public getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Remove an agent from the store
   */
  public removeAgent(instanceUid: Buffer): boolean {
    const instanceUidStr = this.bufferToHex(instanceUid);
    return this.agents.delete(instanceUidStr);
  }

  /**
   * Convert a Buffer to a hex string for use as a map key
   */
  private bufferToHex(buffer: Buffer): string {
    return buffer.toString('hex');
  }
}

// Create a singleton instance of the agent store
export const agentStore = new AgentStore();
