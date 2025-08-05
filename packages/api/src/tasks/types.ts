import { ParsedArgs } from 'minimist';

/**
 * Command line arguments structure for tasks.
 * Contains task name and optional provider configuration.
 */
export type TaskArgs = { taskName: string; provider?: string };

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

  if (argv.provider !== undefined && typeof argv.provider !== 'string') {
    throw new Error('Provider must be a string if provided');
  }

  // Provider is required for check-alerts task
  if (
    argv._[0] === 'check-alerts' &&
    (!argv.provider || argv.provider.trim() === '')
  ) {
    throw new Error('Provider is required for check-alerts task');
  }

  // Provider must contain valid characters if provided (for non-check-alerts tasks)
  if (argv.provider !== undefined && argv.provider.trim() === '') {
    throw new Error('Provider must contain valid characters');
  }

  return {
    taskName: argv._[0],
    provider: argv.provider,
  } as TaskArgs;
}

/**
 * Interface for HyperDX task implementations.
 * All tasks must implement execute and asyncDispose methods.
 */
export interface HdxTask {
  /**
   * Executes the main task logic with validated arguments.
   * @param args - Validated command line arguments
   */
  execute(args: TaskArgs): Promise<void>;

  /**
   * Performs cleanup operations when the task is finished.
   * Should dispose of any resources held by the task.
   */
  asyncDispose(): Promise<void>;
}
