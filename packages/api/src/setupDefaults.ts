import { DEFAULT_SOURCES } from '@/config';
import { createSource, getSources } from '@/controllers/sources';
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
 * Sets up default sources for a team. Connection bootstrapping is gone with
 * the Connection model — Berg gets its Athena auth from the pod's IRSA role
 * and its Athena config from environment variables (`config.ts`).
 *
 * The optional `DEFAULT_SOURCES` env var still supports auto-provisioning a
 * starter set of Table-kind sources.
 */
export async function setupTeamDefaults(teamId: string) {
  logger.info(`Setting up defaults for team: ${teamId}`);

  const parsedDefaultSources = tryParseJSON(DEFAULT_SOURCES);

  if (parsedDefaultSources == null) {
    logger.info(
      'No DEFAULT_SOURCES environment variable defined, skipping auto-provisioning',
    );
    return;
  }

  const team = await getTeam(teamId);
  if (!team) {
    logger.warn({ teamId }, 'Team not found');
    return;
  }

  const sources = await getSources(teamId);
  if (sources.length > 0) {
    logger.info(
      `Sources already exist for team ${teamId}, skipping default source creation`,
    );
    return;
  }

  if (!Array.isArray(parsedDefaultSources)) {
    return;
  }

  for (const sourceConfig of parsedDefaultSources) {
    try {
      // Validate that the source has the required Table-kind fields
      if (
        !sourceConfig.catalog ||
        !sourceConfig.database ||
        !sourceConfig.table ||
        !sourceConfig.displayName
      ) {
        logger.warn(
          `Skipping invalid source config: ${JSON.stringify(sourceConfig)}`,
        );
        continue;
      }

      const newSource = await createSource(teamId, {
        ...sourceConfig,
        kind: 'Table',
        team: team._id,
      });

      logger.info(
        `Created default source: ${sourceConfig.displayName} (${newSource._id})`,
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to create source');
    }
  }
}
