import { CronJob } from 'cron';
import minimist from 'minimist';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { RUN_SCHEDULED_TASKS_EXTERNALLY } from '@/config';
import PingPongTask from '@/tasks//pingPongTask';
import CheckAlertTask from '@/tasks/checkAlerts';
import { asTaskArgs, HdxTask, TaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

function createTask(taskName: string): HdxTask {
  switch (taskName) {
    case 'check-alerts':
      return new CheckAlertTask();
    case 'ping-pong':
      return new PingPongTask();
    default:
      throw new Error(`Unknown task name ${taskName}`);
  }
}

const main = async (argv: TaskArgs) => {
  const taskName = argv.taskName;
  const task: HdxTask = createTask(taskName);
  try {
    const t0 = performance.now();
    logger.info(`Task [${taskName}] started at ${new Date()}`);
    await task.execute(argv);
    logger.info(
      `Task [${taskName}] finished in ${(performance.now() - t0).toFixed(2)} ms`,
    );
  } finally {
    await task.asyncDispose();
  }
};

// Entry point
const argv = asTaskArgs(minimist(process.argv.slice(2)));
// WARNING: the cron job will be enabled only in development mode
if (!RUN_SCHEDULED_TASKS_EXTERNALLY) {
  logger.info('In-app cron job is enabled');
  // run cron job every 1 minute
  const job = CronJob.from({
    cronTime: '0 * * * * *',
    waitForCompletion: true,
    onTick: async () => main(argv),
    errorHandler: async err => {
      console.error(err);
    },
    start: true,
    timeZone: 'UTC',
  });
} else {
  logger.warn('In-app cron job is disabled');
  main(argv)
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
