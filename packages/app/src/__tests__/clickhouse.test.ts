import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';

import api from '@/api';
import { getClickhouseClient, useClickhouseClient } from '@/clickhouse';
import { DEFAULT_QUERY_TIMEOUT } from '@/defaults';

jest.mock('@hyperdx/common-utils/dist/clickhouse/browser', () => ({
  ClickhouseClient: jest.fn(),
}));

jest.mock('@/config', () => ({
  IS_LOCAL_MODE: false,
}));

jest.mock('@/connection', () => ({
  getLocalConnections: jest.fn(() => []),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: { useMe: jest.fn() },
}));

const ClickhouseClientMock = ClickhouseClient as unknown as jest.Mock;
const useMeMock = api.useMe as unknown as jest.Mock;

const constructorArg = () => ClickhouseClientMock.mock.calls[0][0];

describe('getClickhouseClient', () => {
  beforeEach(() => {
    ClickhouseClientMock.mockClear();
  });

  it('caps queries with the default timeout when none is supplied', () => {
    getClickhouseClient();

    expect(constructorArg().queryTimeout).toBe(DEFAULT_QUERY_TIMEOUT);
  });

  // The regression this file exists for: callers pass the team's configured
  // timeout straight through, which is undefined when the team has no override.
  // A spread default would let that undefined win and the query would go out
  // with no max_execution_time at all.
  it('caps queries when queryTimeout is explicitly undefined', () => {
    getClickhouseClient({ queryTimeout: undefined });

    expect(constructorArg().queryTimeout).toBe(DEFAULT_QUERY_TIMEOUT);
  });

  it('respects an explicit timeout', () => {
    getClickhouseClient({ queryTimeout: 300 });

    expect(constructorArg().queryTimeout).toBe(300);
  });

  it('does not mutate the caller-supplied options', () => {
    const options = {};
    getClickhouseClient(options);

    expect(options).toEqual({});
  });
});

// useClickhouseClient reads the team's configured timeout, which is undefined
// for any team without an override — the case that used to go out uncapped.
describe('useClickhouseClient', () => {
  beforeEach(() => {
    ClickhouseClientMock.mockClear();
    useMeMock.mockReset();
  });

  it('falls back to the default when the team has no override', () => {
    useMeMock.mockReturnValue({ data: { team: {} } });
    useClickhouseClient();

    expect(constructorArg().queryTimeout).toBe(DEFAULT_QUERY_TIMEOUT);
  });

  it("uses the team's override when set", () => {
    useMeMock.mockReturnValue({ data: { team: { queryTimeout: 120 } } });
    useClickhouseClient();

    expect(constructorArg().queryTimeout).toBe(120);
  });

  it('falls back to the default before /me resolves', () => {
    useMeMock.mockReturnValue({ data: undefined });
    useClickhouseClient();

    expect(constructorArg().queryTimeout).toBe(DEFAULT_QUERY_TIMEOUT);
  });
});
