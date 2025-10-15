import { CronJob } from 'cron';
import minimist from 'minimist';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { RUN_SCHEDULED_TASKS_EXTERNALLY } from '@/config';
import CheckAlertTask from '@/tasks/checkAlerts';
import PingPongTask from '@/tasks/pingPongTask';
import { asTaskArgs, HdxTask, TaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

import { tasksTracer } from './tracer';

function createTask(argv: TaskArgs): HdxTask<TaskArgs> {
  const taskName = argv.taskName;
  switch (taskName) {
    case 'check-alerts':
      return new CheckAlertTask(argv);
    case 'ping-pong':
      return new PingPongTask(argv);
    default:
      throw new Error(`Unknown task name ${taskName}`);
  }
}

const main = async (argv: TaskArgs) => {
  await tasksTracer.startActiveSpan(argv.taskName || 'task', async span => {
    const task: HdxTask<TaskArgs> = createTask(argv);
    try {
      const t0 = performance.now();
      logger.info(`Task [${task.name()}] started at ${new Date()}`);
      await task.execute();
      logger.info(
        `Task [${task.name()}] finished in ${(performance.now() - t0).toFixed(2)} ms`,
      );
    } catch (e: unknown) {
      logger.error({
        message: `Task [${task.name()}] failed: ${serializeError(e)}`,
        cause: e,
        task,
      });
    } finally {
      await task.asyncDispose();
      span.end();
    }
  });
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
      logger.error({ err: serializeError(err) }, 'Task execution failed');
      process.exit(1);
    });
}

process.on('uncaughtException', (err: Error) => {
  console.log(err);
  logger.error({ err: serializeError(err) }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (err: any) => {
  console.log(err);
  logger.error({ err: serializeError(err) }, 'Unhandled rejection');
  process.exit(1);
});
