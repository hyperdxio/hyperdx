import minimist from 'minimist';
import schedule from 'node-schedule';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { IS_DEV } from '@/config';
import { connectDB, mongooseConnection } from '@/models';
import addSystemAlerts from '@/tasks/alerts/addSystemAlerts';
import checkAnomalyAlerts from '@/tasks/alerts/checkAnomalyAlerts';
import checkUserAlerts from '@/tasks/alerts/checkUserAlerts';
import refreshPropertyTypeMappings from '@/tasks/refreshPropertyTypeMappings';
import logger from '@/utils/logger';
import redisClient from '@/utils/redis';

const main = async () => {
  const argv = minimist(process.argv.slice(2));
  const taskName = argv._[0];

  // connect dbs + redis
  await Promise.all([connectDB(), redisClient.connect()]);

  const t0 = performance.now();
  logger.info(`Task [${taskName}] started at ${new Date()}`);
  switch (taskName) {
    case 'add-system-alerts':
      await addSystemAlerts();
      break;
    // TODO: rename to check-users-alerts
    case 'check-alerts':
      await checkUserAlerts();
      break;
    case 'check-anomaly-alerts':
      await checkAnomalyAlerts();
      break;
    case 'refresh-property-type-mappings':
      await refreshPropertyTypeMappings();
      break;
    // only for testing
    case 'ping-pong':
      logger.info(`
                 O .
               _/|\\_-O
              ___|_______
             /     |     \
            /      |      \
           #################
          /   _ ( )|        \
         /    ( ) ||         \
        /  \\  |_/ |          \
       /____\\/|___|___________\
          |    |             |
          |   / \\           |
          |  /   \\          |
          |_/    /_
      `);
      break;
    default:
      throw new Error(`Unkown task name ${taskName}`);
  }
  logger.info(
    `Task [${taskName}] finished in ${(performance.now() - t0).toFixed(2)} ms`,
  );

  // close redis + db connections
  await Promise.all([redisClient.disconnect(), mongooseConnection.close()]);
};

if (IS_DEV) {
  schedule.scheduleJob('*/1 * * * *', main);
} else {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.log(err);
      logger.error(serializeError(err));
      process.exit(1);
    });
}

process.on('uncaughtException', (err: Error) => {
  console.log(err);
  logger.error(serializeError(err));
  process.exit(1);
});

process.on('unhandledRejection', (err: any) => {
  console.log(err);
  logger.error(serializeError(err));
  process.exit(1);
});
