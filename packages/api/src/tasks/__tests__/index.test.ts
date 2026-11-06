const mockShutdown = jest.fn<Promise<void>, []>();
const mockCronStop = jest.fn();
const mockCronFrom = jest.fn((_options: unknown) => ({ stop: mockCronStop }));
const mockConfig = {
  CODE_VERSION: 'test',
  RUN_SCHEDULED_TASKS_EXTERNALLY: false,
};

jest.mock('@clickhouse/clickstack-node', () => ({
  shutdown: () => mockShutdown(),
}));
jest.mock('cron', () => ({
  CronJob: { from: (options: unknown) => mockCronFrom(options) },
}));
jest.mock('@/config', () => mockConfig);
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/tasks/checkAlerts', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/tasks/provisionDashboards', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

describe('tasks entry point', () => {
  const originalArgv = process.argv;
  // Jest's process copy forwards exitCode to the real process.
  const originalExitCode = process.exitCode;
  let processOn: jest.SpyInstance;
  let processExit: jest.SpyInstance;
  let finishShutdown: () => void;

  const loadTasks = () => {
    process.argv = ['node', 'tasks', 'ping-pong'];
    jest.isolateModules(() => {
      jest.requireActual('@/tasks/index');
    });
  };

  const handlerFor = (event: string) => {
    const call = processOn.mock.calls.find(([name]) => name === event);
    if (!call) {
      throw new Error(`No ${event} handler registered`);
    }
    return call[1];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockShutdown.mockReturnValue(
      new Promise(resolve => {
        finishShutdown = resolve;
      }),
    );
    processOn = jest.spyOn(process, 'on').mockReturnValue(process);
    processExit = jest.spyOn(process, 'exit').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  });

  it('stops the cron job and shuts down once, exiting with the first code', async () => {
    mockConfig.RUN_SCHEDULED_TASKS_EXTERNALLY = false;
    loadTasks();
    expect(mockCronFrom).toHaveBeenCalledTimes(1);

    handlerFor('uncaughtException')(new Error('first'));
    handlerFor('unhandledRejection')(new Error('second'));
    handlerFor('uncaughtException')(new Error('third'));

    expect(mockCronStop).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockCronStop.mock.invocationCallOrder[0]).toBeLessThan(
      mockShutdown.mock.invocationCallOrder[0],
    );
    expect(process.exitCode).toBe(1);
    expect(processExit).not.toHaveBeenCalled();

    finishShutdown();
    await flushPromises();

    expect(processExit).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(1);
  });

  it('keeps exit code 0 when a rejection arrives during the one-shot shutdown', async () => {
    mockConfig.RUN_SCHEDULED_TASKS_EXTERNALLY = true;
    loadTasks();
    await flushPromises();
    expect(mockCronFrom).not.toHaveBeenCalled();
    expect(mockShutdown).toHaveBeenCalledTimes(1);

    handlerFor('unhandledRejection')(new Error('late'));
    expect(mockShutdown).toHaveBeenCalledTimes(1);

    finishShutdown();
    await flushPromises();

    expect(processExit).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(0);
  });
});
