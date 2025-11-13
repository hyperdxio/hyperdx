import { CronJob } from 'cron';
import minimist from 'minimist';
import { serializeError } from 'serialize-error';

import { RUN_SCHEDULED_TASKS_EXTERNALLY } from '@/config';
import CheckAlertTask from '@/tasks/checkAlerts';
import {
  taskExecutionDurationGauge,
  taskExecutionFailureCounter,
  taskExecutionSuccessCounter,
  timeExec,
} from '@/tasks/metrics';
import PingPongTask from '@/tasks/pingPongTask';
import { asTaskArgs, HdxTask, TaskArgs, TaskName } from '@/tasks/types';
import logger from '@/utils/logger';

import { tasksTracer } from './tracer';

function createTask(argv: TaskArgs): HdxTask<TaskArgs> {
  const taskName = argv.taskName;
  switch (taskName) {
    case TaskName.CHECK_ALERTS:
      return new CheckAlertTask(argv);
    case TaskName.PING_PONG:
      return new PingPongTask(argv);
    default:
      throw new Error(`Unknown task name ${taskName}`);
  }
}

async function main(argv: TaskArgs): Promise<void> {
  await tasksTracer.startActiveSpan(argv.taskName || 'task', async span => {
    const task: HdxTask<TaskArgs> = createTask(argv);
    try {
      logger.info(`${task.name()} started at ${new Date()}`);
      await task.execute();
      taskExecutionSuccessCounter.get(argv.taskName)?.add(1);
    } catch (e: unknown) {
      logger.error(
        {
          cause: e,
          task,
        },
        `${task.name()} failed: ${serializeError(e)}`,
      );
      taskExecutionFailureCounter.get(argv.taskName)?.add(1);
    } finally {
      await task.asyncDispose();
      span.end();
    }
  });
}

// Entry point
const argv = asTaskArgs(minimist(process.argv.slice(2)));

const instrumentedMain = timeExec(main, duration => {
  const gauge = taskExecutionDurationGauge.get(argv.taskName);
  if (gauge) {
    gauge.record(duration, { useCron: !RUN_SCHEDULED_TASKS_EXTERNALLY });
  }
  logger.info(`${argv.taskName} finished in ${duration.toFixed(2)} ms`);
});

// WARNING: the cron job will be enabled only in development mode
if (!RUN_SCHEDULED_TASKS_EXTERNALLY) {
  logger.info('In-app cron job is enabled');
  // run cron job every 1 minute
  const job = CronJob.from({
    cronTime: '0 * * * * *',
    waitForCompletion: true,
    onTick: async () => instrumentedMain(argv),
    errorHandler: async err => {
      console.error(err);
    },
    start: true,
    timeZone: 'UTC',
  });
} else {
  logger.warn('In-app cron job is disabled');
  instrumentedMain(argv)
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
