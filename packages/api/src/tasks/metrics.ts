import {
  Attributes,
  Counter,
  Gauge,
  metrics,
  ValueType,
} from '@opentelemetry/api';
import { performance } from 'perf_hooks';

import { TaskName } from '@/tasks/types';

const meter = metrics.getMeter('hyperdx-tasks');

export const taskExecutionSuccessCounter: Map<
  TaskName,
  Counter<Attributes>
> = new Map();

export const taskExecutionFailureCounter: Map<
  TaskName,
  Counter<Attributes>
> = new Map();

export const taskExecutionDurationGauge: Map<
  TaskName,
  Gauge<Attributes>
> = new Map();

for (const name of Object.values(TaskName)) {
  taskExecutionSuccessCounter.set(
    name,
    meter.createCounter(`hyperdx.tasks.${name}.success`, {
      description:
        'Count of the number of times the task finished without exceptions.',
    }),
  );

  taskExecutionFailureCounter.set(
    name,
    meter.createCounter(`hyperdx.tasks.${name}.failure`, {
      description:
        'Count of the number of times the task failed to finish because of an exception',
    }),
  );

  taskExecutionDurationGauge.set(
    name,
    meter.createGauge(`hyperdx.tasks.${name}.duration`, {
      description: `The wall time required for the ${name} task to complete execution.`,
      unit: 'ms',
      valueType: ValueType.DOUBLE,
    }),
  );
}

export function timeExec<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  recordFn?: (duration: number) => void,
) {
  return async (...args: T) => {
    const start = performance.now();
    try {
      return await fn(...args);
    } finally {
      if (recordFn) {
        const end = performance.now();
        recordFn(end - start);
      }
    }
  };
}
