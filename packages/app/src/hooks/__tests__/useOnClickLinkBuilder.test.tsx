import type {
  OnClickDashboard,
  OnClickSearch,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';

import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

import { useOnClickLinkBuilder } from '../useOnClickLinkBuilder';

jest.mock('@/source', () => ({
  useSources: jest.fn(),
}));

jest.mock('@/dashboard', () => ({
  useDashboards: jest.fn(),
}));

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

describe('useOnClickLinkBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useSources).mockReturnValue({
      data: [
        {
          id: 'src_1',
          name: 'HyperDX Logs',
          kind: 'log',
          connection: 'c',
          from: { databaseName: 'd', tableName: 't' },
          timestampValueExpression: 'Timestamp',
        },
      ],
    } as any);
    jest.mocked(useDashboards).mockReturnValue({
      data: [{ id: 'dash_1', name: 'API Latency Drilldown', tiles: [] }],
    } as any);
  });

  it('returns null when no onClick is configured', () => {
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick: undefined, dateRange }),
    );
    expect(result.current).toBeNull();
  });

  it('returns a row resolver that includes the resolved source name in the description', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    expect(result.current).not.toBeNull();
    const action = result.current!({});
    expect(action.description).toBe('Search HyperDX Logs');
    expect(action.url).toMatch(/^\/search\?source=src_1&/);
    expect(action.onClickError).toBeUndefined();
  });

  it('returns a row resolver that includes the resolved dashboard name in the description', () => {
    const onClick: OnClickDashboard = {
      type: 'dashboard',
      target: { mode: 'id', id: 'dash_1' },
      whereLanguage: 'sql',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    const action = result.current!({});
    expect(action.description).toBe('Open dashboard "API Latency Drilldown"');
    expect(action.url).toMatch(/^\/dashboards\/dash_1\?/);
  });

  it('encodes a row resolution failure as url: null with a click handler that fires a notification', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'template', template: '{{MissingColumn}}' },
      whereLanguage: 'sql',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    const action = result.current!({ Src: 'Logs' });
    expect(action.url).toBeNull();
    expect(action.description).toBe('Open in search');
    expect(action.onClickError).toBeInstanceOf(Function);

    // Render time is silent: no toast fires while computing the URL.
    expect(jest.mocked(notifications.show)).not.toHaveBeenCalled();

    // Clicking the failing row fires the toast.
    const preventDefault = jest.fn();
    action.onClickError!({ preventDefault } as any);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifications.show)).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'red',
        title: 'Link error',
        message: "Row has no column 'MissingColumn'",
      }),
    );
  });
});
