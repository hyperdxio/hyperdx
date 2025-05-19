import { DEFAULT_CONNECTIONS, DEFAULT_SOURCES } from '@/config';
import { createConnection, getConnections } from '@/controllers/connection';
import { createSource, getSources, updateSource } from '@/controllers/sources';
import { getTeam } from '@/controllers/team';
import logger from '@/utils/logger';

function tryParseJSON(str: string | undefined) {
  try {
    if (str != null) {
      return JSON.parse(str);
    }
  } catch (e) {
    // skip
  }
  return undefined;
}

/**
 * Sets up default connections and sources for a team
 * @param teamId The ID of the team to set up defaults for
 * @returns Promise that resolves when setup is complete
 */
export async function setupTeamDefaults(teamId: string) {
  logger.info(`Setting up defaults for team: ${teamId}`);

  const parsedDefaultConnections = tryParseJSON(DEFAULT_CONNECTIONS);
  const parsedDefaultSources = tryParseJSON(DEFAULT_SOURCES);

  if (parsedDefaultConnections == null && parsedDefaultSources == null) {
    logger.info(
      'No DEFAULT_CONNECTIONS or DEFAULT_SOURCES environment variables defined, skipping auto-provisioning',
    );
    return;
  }

  // Get the team object
  const team = await getTeam(teamId);
  if (!team) {
    logger.warn(`Team not found with ID: ${teamId}`);
    return;
  }

  // Check existing connections for this team
  const connections = await getConnections();
  const teamConnections = connections.filter(c => c.team.toString() === teamId);

  // Create default connections if none exist for this team
  if (teamConnections.length === 0 && Array.isArray(parsedDefaultConnections)) {
    logger.info(
      `No connections found for team ${teamId}, creating default connections`,
    );

    for (const connectionConfig of parsedDefaultConnections) {
      try {
        // Validate that the connection has the required fields
        if (!connectionConfig.name || !connectionConfig.host) {
          logger.warn(
            `Skipping invalid connection config: ${JSON.stringify(connectionConfig)}`,
          );
          continue;
        }

        // Create the connection
        const newConnection = await createConnection(teamId, {
          ...connectionConfig,
          password: connectionConfig.password || '',
          team: team._id,
        });

        logger.info(
          `Created default connection: ${connectionConfig.name} (${newConnection._id})`,
        );
      } catch (error) {
        logger.error(`Failed to create connection: ${error}`);
      }
    }
  } else if (parsedDefaultConnections) {
    logger.info(
      `Connections already exist for team ${teamId}, skipping default connection creation`,
    );
  }

  // Check existing sources for this team
  const sources = await getSources(teamId);

  // Create default sources if none exist
  if (sources.length === 0 && Array.isArray(parsedDefaultSources)) {
    logger.info(
      `No sources found for team ${teamId}, creating default sources`,
    );

    // Get the connections again in case we just created some
    const updatedConnections = await getConnections();
    const teamUpdatedConnections = updatedConnections.filter(
      c => c.team.toString() === teamId,
    );

    if (teamUpdatedConnections.length === 0) {
      logger.warn(
        `Cannot create default sources: no connections available for team ${teamId}`,
      );
      return;
    }

    // Create a mapping of source configurations by name for later correlation
    const sourceConfigsByName: { [key: string]: any } = {};

    // First create all sources
    const createdSources: { [key: string]: any } = {};

    for (const sourceConfig of parsedDefaultSources) {
      try {
        // Validate that the source has the required fields
        if (
          !sourceConfig.name ||
          !sourceConfig.kind ||
          !sourceConfig.connection
        ) {
          logger.warn(
            `Skipping invalid source config: ${JSON.stringify(sourceConfig)}`,
          );
          continue;
        }

        // Store the config by name for later reference
        sourceConfigsByName[sourceConfig.name] = sourceConfig;

        // Find the connection by name if string provided
        let connectionId = sourceConfig.connection;
        if (
          typeof connectionId === 'string' &&
          !connectionId.match(/^[0-9a-fA-F]{24}$/)
        ) {
          // If not a valid ObjectId, treat as a connection name
          const connection = teamUpdatedConnections.find(
            c => c.name === connectionId,
          );
          if (!connection) {
            logger.warn(`Connection not found with name: ${connectionId}`);
            continue;
          }
          connectionId = connection._id.toString();
        }

        // Create a cleaned version of the source config without reference fields
        // that will be processed in the second pass
        const sourceConfigCleaned = {
          ...sourceConfig,
          connection: connectionId,
          team: team._id,
        };

        // Remove source reference fields that will be handled in the second pass
        delete sourceConfigCleaned.logSourceId;
        delete sourceConfigCleaned.traceSourceId;
        delete sourceConfigCleaned.sessionSourceId;
        delete sourceConfigCleaned.metricSourceId;

        // Create the source
        const newSource = await createSource(teamId, sourceConfigCleaned);

        logger.info(
          `Created default source: ${sourceConfig.name} (${newSource._id})`,
        );

        // Store the created source for the second pass
        createdSources[sourceConfig.name] = newSource;
      } catch (error) {
        logger.error(`Failed to create source: ${error}`);
      }
    }

    // Second pass: update sources with references to other sources
    for (const sourceName in createdSources) {
      try {
        const sourceConfig = sourceConfigsByName[sourceName];
        const createdSource = createdSources[sourceName];

        // Check if this source has any reference fields that need to be updated
        const updateFields: { [key: string]: string } = {};

        // Process logSourceId reference
        if (
          sourceConfig.logSourceId &&
          createdSources[sourceConfig.logSourceId]
        ) {
          updateFields.logSourceId =
            createdSources[sourceConfig.logSourceId]._id.toString();
        }

        // Process traceSourceId reference
        if (
          sourceConfig.traceSourceId &&
          createdSources[sourceConfig.traceSourceId]
        ) {
          updateFields.traceSourceId =
            createdSources[sourceConfig.traceSourceId]._id.toString();
        }

        // Process sessionSourceId reference
        if (
          sourceConfig.sessionSourceId &&
          createdSources[sourceConfig.sessionSourceId]
        ) {
          updateFields.sessionSourceId =
            createdSources[sourceConfig.sessionSourceId]._id.toString();
        }

        // Process metricSourceId reference
        if (
          sourceConfig.metricSourceId &&
          createdSources[sourceConfig.metricSourceId]
        ) {
          updateFields.metricSourceId =
            createdSources[sourceConfig.metricSourceId]._id.toString();
        }

        // If we have fields to update, update the source
        if (Object.keys(updateFields).length > 0) {
          await updateSource(teamId, createdSource._id.toString(), {
            ...createdSource.toObject(),
            ...updateFields,
          });

          logger.info(
            `Updated source ${sourceName} with references: ${JSON.stringify(updateFields)}`,
          );
        }
      } catch (error) {
        logger.error(`Failed to update source references: ${error}`);
      }
    }
  } else if (parsedDefaultSources) {
    logger.info(
      `Sources already exist for team ${teamId}, skipping default source creation`,
    );
  }
}
