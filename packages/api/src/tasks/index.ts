import { CronJob } from 'cron';
import minimist from 'minimist';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { IS_DEV } from '@/config';
import { connectDB, mongooseConnection } from '@/models';
import logger from '@/utils/logger';
import redisClient from '@/utils/redis';

import checkAlerts from './checkAlerts';
import refreshPropertyTypeMappings from './refreshPropertyTypeMappings';

const shutdown = async () =>
  Promise.all([redisClient.disconnect(), mongooseConnection.close()]);

const main = async (taskName: string) => {
  // connect dbs + redis
  await Promise.all([connectDB(), redisClient.connect()]);

  const t0 = performance.now();
  logger.info(`Task [${taskName}] started at ${new Date()}`);
  switch (taskName) {
    case 'check-alerts':
      await checkAlerts();
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

  await shutdown();
};

// Entry point
const argv = minimist(process.argv.slice(2));
const taskName = argv._[0];
// WARNING: the cron job will be enabled only in development mode
if (IS_DEV) {
  // run cron job every 15 seconds
  const job = CronJob.from({
    cronTime: '*/15 * * * * *',
    waitForCompletion: true,
    onTick: async () => main(taskName),
    errorHandler: async err => {
      console.error(err);
      await shutdown();
    },
    start: true,
    timeZone: 'UTC',
  });
} else {
  main(taskName)
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
