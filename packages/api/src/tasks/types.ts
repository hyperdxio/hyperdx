import { z } from 'zod';

export enum TaskName {
  PING_PONG = 'ping-pong',
}

/**
 * Command line arguments structure for tasks.
 * Contains task name and optional provider configuration.
 */
const pingTaskArgsSchema = z.object({
  taskName: z.literal(TaskName.PING_PONG),
});

const taskArgsSchema = z.discriminatedUnion('taskName', [pingTaskArgsSchema]);

export type PingTaskArgs = z.infer<typeof pingTaskArgsSchema>;
export type TaskArgs = z.infer<typeof taskArgsSchema>;

/**
 * Validates and converts command line arguments to TaskArgs type.
 * Throws descriptive errors for invalid input.
 *
 * @param argv - Raw command line arguments object
 * @returns Validated TaskArgs object
 * @throws Error when arguments are invalid
 */
export function asTaskArgs(argv: any): TaskArgs {
  if (argv == null) {
    throw new Error('Arguments cannot be null or undefined');
  }

  if (typeof argv !== 'object' || Array.isArray(argv)) {
    throw new Error('Arguments must be an object');
  }

  // ParsedArgs requires _ property to be an array of strings
  if (!Array.isArray(argv._)) {
    throw new Error('Arguments must have a "_" property that is an array');
  }

  // Ensure all elements in _ array are strings (as required by ParsedArgs)
  if (!argv._.every((arg: any) => typeof arg === 'string')) {
    throw new Error('All arguments in "_" array must be strings');
  }

  const { _, ...rest } = argv;
  if (_.length < 1) {
    throw new Error('Task name needs to be specified');
  }
  const taskName = _[0];

  return taskArgsSchema.parse({
    taskName,
    ...rest,
  });
}

/**
 * Interface for HyperDX task implementations.
 * All tasks must implement execute and asyncDispose methods.
 */
export interface HdxTask<T extends TaskArgs> {
  /**
   * Executes the main task logic with validated arguments.
   * @param args - Validated command line arguments
   */
  execute(): Promise<void>;

  /**
   * Performs cleanup operations when the task is finished.
   * Should dispose of any resources held by the task.
   */
  asyncDispose(): Promise<void>;

  name(): string;
}

// Utility type to omit keys K from type T, similar to Omit<T, K> but works on discriminated unions
export type MappedOmit<T, K extends keyof T> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};
