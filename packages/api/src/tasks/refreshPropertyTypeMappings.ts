// --------------------------------------------------------
// ------------------ EXECUTE HOURLY ----------------------
// --------------------------------------------------------
import ms from 'ms';

import * as clickhouse from '../clickhouse';
import Team from '../models/team';
import logger from '../utils/logger';
import { LogsPropertyTypeMappingsModel } from '../clickhouse/propertyTypeMappingsModel';

const MAX_PROCESS_TEAMS = 30;
const LOG_PREFIX = '[refreshPropertyTypeMappings]';

export default async () => {
  const nowInMs = Date.now();
  const teams = await Team.find({});
  let c = 0;
  const promises = [];
  for (const team of teams) {
    if (c >= MAX_PROCESS_TEAMS) {
      logger.info(`${LOG_PREFIX} Processed ${c} teams, exiting...`);
      break;
    }
    const teamId = team._id.toString();
    const model = new LogsPropertyTypeMappingsModel(
      team.logStreamTableVersion,
      teamId,
      clickhouse.fetchLogsPropertyTypeMappings(nowInMs - ms('3d'), nowInMs),
    );
    const isAboutToExpire = await model.isAboutToExpire();
    if (isAboutToExpire) {
      logger.info(`${LOG_PREFIX} Refreshing team ${teamId}`);
      promises.push(model._refresh({ incrementalUpdate: false }));
      c += 1;
    } else {
      logger.info(`${LOG_PREFIX} Skipping team ${teamId}`);
    }
  }

  await Promise.all(promises);
  logger.info(`${LOG_PREFIX} Refreshed ${c} teams`);
};
