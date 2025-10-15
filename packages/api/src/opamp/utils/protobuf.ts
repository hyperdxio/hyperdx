import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as protobuf from 'protobufjs';

import { IS_PROD } from '@/config';
import logger from '@/utils/logger';

// Define the root path of the proto file
const PROTO_PATH = path.resolve(
  __dirname,
  `${IS_PROD ? 'opamp' : '..'}/proto/opamp.proto`,
);

// Load the OpAMP proto definition
let root: protobuf.Root;
try {
  if (!fs.existsSync(PROTO_PATH)) {
    throw new Error(`Proto file not found at ${PROTO_PATH}`);
  }
  root = protobuf.loadSync(PROTO_PATH);
  logger.debug('OpAMP proto definition loaded successfully');
} catch (error) {
  logger.error({ err: error }, 'Failed to load OpAMP proto definition');
  throw error;
}

// Get message types
const AgentToServer = root.lookupType('opamp.AgentToServer');
const ServerToAgent = root.lookupType('opamp.ServerToAgent');
const AgentRemoteConfig = root.lookupType('opamp.AgentRemoteConfig');
const AgentConfigMap = root.lookupType('opamp.AgentConfigMap');
const AgentConfigFile = root.lookupType('opamp.AgentConfigFile');
const ServerCapabilities = root.lookupEnum('opamp.ServerCapabilities');

// Define the server capabilities
const serverCapabilities =
  ServerCapabilities.values.AcceptsStatus |
  ServerCapabilities.values.OffersRemoteConfig |
  ServerCapabilities.values.AcceptsEffectiveConfig;

/**
 * Decode an AgentToServer message from binary data
 */
export function decodeAgentToServer(data: Buffer): protobuf.Message {
  try {
    return AgentToServer.decode(data);
  } catch (error) {
    logger.error({ err: error }, 'Failed to decode AgentToServer message');
    throw error;
  }
}

/**
 * Encode a ServerToAgent message to binary data
 */
export function encodeServerToAgent(message: any): Buffer {
  try {
    // Verify the message
    const error = ServerToAgent.verify(message);
    if (error) {
      throw new Error(`Invalid ServerToAgent message: ${error}`);
    }

    // Create a message instance
    const serverToAgent = ServerToAgent.create(message);

    // Encode the message
    return Buffer.from(ServerToAgent.encode(serverToAgent).finish());
  } catch (error) {
    logger.error({ err: error }, 'Failed to encode ServerToAgent message');
    throw error;
  }
}

/**
 * Create a remote configuration message
 */
export function createRemoteConfig(
  configFiles: Map<string, Buffer>,
  configType: string = 'text/yaml',
): any {
  try {
    // Convert the configFiles map to the format expected by AgentConfigMap
    const configMap: { [key: string]: any } = {};

    configFiles.forEach((content, filename) => {
      configMap[filename] = {
        body: content,
        contentType: configType,
      };
    });

    // Create the AgentConfigMap message
    const agentConfigMap = {
      configMap: configMap,
    };

    // Calculate the config hash
    const configHash = calculateConfigHash(configFiles);

    // Create the AgentRemoteConfig message
    return {
      config: agentConfigMap,
      configHash: configHash,
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to create remote config message');
    throw error;
  }
}

/**
 * Calculate a hash for the configuration files
 */
function calculateConfigHash(configFiles: Map<string, Buffer>): Buffer {
  try {
    const hash = createHash('sha256');

    // Sort keys to ensure consistent hashing
    const sortedKeys = Array.from(configFiles.keys()).sort();

    for (const key of sortedKeys) {
      const content = configFiles.get(key);
      if (content) {
        hash.update(key);
        hash.update(content);
      }
    }

    return hash.digest();
  } catch (error) {
    logger.error({ err: error }, 'Failed to calculate config hash');
    throw error;
  }
}

export {
  AgentConfigFile,
  AgentConfigMap,
  AgentRemoteConfig,
  AgentToServer,
  root,
  serverCapabilities,
  ServerToAgent,
};
