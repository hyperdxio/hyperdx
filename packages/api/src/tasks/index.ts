import { CronJob } from 'cron';
import minimist from 'minimist';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { RUN_SCHEDULED_TASKS_EXTERNALLY } from '@/config';
import checkAlerts from '@/tasks/checkAlerts';
import { loadProvider } from '@/tasks/providers';
import logger from '@/utils/logger';

const main = async (
  alertProviderName: string | undefined,
  taskName: string,
) => {
  const alertProvider = await loadProvider(alertProviderName);
  try {
    await alertProvider.init();
    const t0 = performance.now();
    logger.info(`Task [${taskName}] started at ${new Date()}`);
    switch (taskName) {
      case 'check-alerts':
        await checkAlerts(alertProvider);
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
        throw new Error(`Unknown task name ${taskName}`);
    }
    logger.info(
      `Task [${taskName}] finished in ${(performance.now() - t0).toFixed(2)} ms`,
    );
  } finally {
    await alertProvider.asyncDispose();
  }
};

// Entry point
const argv = minimist(process.argv.slice(2));
const alertProviderName = argv.provider;
const taskName = argv._[0];
// WARNING: the cron job will be enabled only in development mode
if (!RUN_SCHEDULED_TASKS_EXTERNALLY) {
  logger.info('In-app cron job is enabled');
  // run cron job every 1 minute
  const job = CronJob.from({
    cronTime: '0 * * * * *',
    waitForCompletion: true,
    onTick: async () => main(alertProviderName, taskName),
    errorHandler: async err => {
      console.error(err);
    },
    start: true,
    timeZone: 'UTC',
  });
} else {
  logger.warn('In-app cron job is disabled');
  main(alertProviderName, taskName)
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
