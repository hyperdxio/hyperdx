import { CronJob } from 'cron';
import minimist from 'minimist';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { RUN_SCHEDULED_TASKS_EXTERNALLY } from '@/config';
import { connectDB, mongooseConnection } from '@/models';
import logger from '@/utils/logger';

import checkAlerts from './checkAlerts';

const shutdown = async () => Promise.all([mongooseConnection.close()]);

const main = async (taskName: string) => {
  // connect dbs
  await Promise.all([connectDB()]);

  const t0 = performance.now();
  logger.info(`Task [${taskName}] started at ${new Date()}`);
  switch (taskName) {
    case 'check-alerts':
      await checkAlerts();
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
if (!RUN_SCHEDULED_TASKS_EXTERNALLY) {
  logger.info('In-app cron job is enabled');
  // run cron job every 1 minute
  const job = CronJob.from({
    cronTime: '0 * * * * *',
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
  logger.warn('In-app cron job is disabled');
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
