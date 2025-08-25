/**
 * Command line arguments structure for tasks.
 * Contains task name and optional provider configuration.
 */
export type PingTaskArgs = { taskName: 'ping-pong' };
export type CheckAlertsTaskArgs = {
  taskName: 'check-alerts';
  // name of the provider module to use for fetching alert task data. If not defined,
  // the default provider will be used.
  provider?: string;
  // Limits number of concurrent tasks processed. If omitted, there is no concurrency
  // limit. Must be an integer greater than 0.
  concurrency?: number;
};
export type TaskArgs = PingTaskArgs | CheckAlertsTaskArgs;

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

  const taskName = argv._[0];
  if (taskName === 'check-alerts') {
    const { provider, concurrency } = argv;
    if (provider) {
      if (typeof provider !== 'string') {
        throw new Error('Provider must be a string if provided');
      }

      if (provider.trim() === '') {
        throw new Error('Provider must contain valid characters');
      }
    }

    if (concurrency !== undefined) {
      if (typeof concurrency !== 'number') {
        throw new Error('Concurrency must be a number if provided');
      }

      if (!Number.isInteger(concurrency)) {
        throw new Error('Concurrency must be an integer if provided');
      }

      if (concurrency < 1) {
        throw new Error('Concurrency cannot be less than 1');
      }
    }

    return {
      taskName: 'check-alerts',
      provider: provider,
      concurrency: concurrency,
    };
  } else if (taskName === 'ping-pong') {
    return {
      taskName: 'ping-pong',
    };
  } else {
    // For any other task names, create a generic structure without provider
    return {
      taskName,
      provider: argv.provider,
    } as TaskArgs;
  }
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
