import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

jest.mock('@/api-app', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/controllers/team', () => ({
  LOCAL_APP_TEAM: { _id: { toString: () => 'local-team' } },
}));
jest.mock('@/migrations', () => ({ runStartupMigrations: jest.fn() }));
jest.mock('@/models', () => ({
  connectDB: jest.fn().mockResolvedValue(undefined),
  connectDBWithRetry: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/opamp/app', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/setupDefaults', () => ({ setupTeamDefaults: jest.fn() }));
jest.mock('@/utils/tokenEncryption', () => ({
  verifyTokenEncryption: jest.fn(),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn() },
}));
jest.mock('@/utils/instrumentation', () => ({
  getCounter: jest.fn(() => ({ add: jest.fn() })),
}));
jest.mock('http-graceful-shutdown', () => jest.fn());
jest.mock('http', () => ({
  ...jest.requireActual('http'),
  createServer: jest.fn(() => ({ listen: jest.fn() })),
}));

describe.each(['server', 'serverless'])(
  'session secret startup diagnostics (%s first)',
  first => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      jest.resetModules();
    });

    it.each([
      [false, undefined, 1],
      [false, '', 1],
      [false, 'startup-secret-sentinel', 0],
      [true, undefined, 0],
      [true, 'startup-secret-sentinel', 0],
    ])(
      'local=%s, secret=%s logs %s times across both entrypoints',
      async (local, secret, count) => {
        process.env.APP_TYPE = 'api';
        if (local) {
          process.env.IS_LOCAL_APP_MODE = 'DANGEROUSLY_is_local_app_mode💀';
        } else {
          delete process.env.IS_LOCAL_APP_MODE;
        }
        if (typeof secret === 'undefined')
          delete process.env.EXPRESS_SESSION_SECRET;
        else process.env.EXPRESS_SESSION_SECRET = secret;

        /* eslint-disable @typescript-eslint/no-require-imports, n/no-missing-require */
        const {
          default: logger,
        }: typeof import('@/utils/logger') = require('@/utils/logger');
        const {
          getCounter,
        }: typeof import('@/utils/instrumentation') = require('@/utils/instrumentation');
        const {
          default: Server,
        }: typeof import('@/server') = require('@/server');
        const {
          serverlessHandler,
        }: typeof import('@/serverless') = require('@/serverless');
        const config: typeof import('@/config') = require('@/config');
        /* eslint-enable @typescript-eslint/no-require-imports, n/no-missing-require */
        expect(logger.error).not.toHaveBeenCalled();

        const req = new IncomingMessage(new Socket());
        req.url = '/api/health';
        const res = new ServerResponse(req);
        if (first === 'server') await new Server().start();
        await serverlessHandler(req, res);
        await new Server().start();
        await serverlessHandler(req, res);

        expect(logger.error).toHaveBeenCalledTimes(count);
        const counter = jest.mocked(getCounter).mock.results[0].value;
        expect(counter.add).toHaveBeenCalledTimes(count);
        expect(
          JSON.stringify(jest.mocked(logger.error).mock.calls),
        ).not.toContain(config.EXPRESS_SESSION_SECRET);
      },
    );
  },
);
