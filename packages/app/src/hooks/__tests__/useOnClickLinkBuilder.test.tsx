import type {
  OnClickDashboard,
  OnClickExternal,
  OnClickSearch,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';

import { useDashboards } from '@/dashboard';
import { useOnClickLinkBuilder } from '@/hooks/useOnClickLinkBuilder';
import { useSources } from '@/source';

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
    const params = new URLSearchParams(action.url!.split('?')[1]);
    expect(action.url!.startsWith('/search?')).toBe(true);
    expect(params.get('source')).toBe('src_1');
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
    expect(action.url!.startsWith('/dashboards/dash_1?')).toBe(true);
  });

  it('resolves an external link to an absolute URL marked external', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate:
        'https://grafana.example.com/d/abc?var-service={{ServiceName}}',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    const action = result.current!({ ServiceName: 'checkout' });
    // The resolved destination URL is surfaced as the hover hint so the
    // user can see exactly where an external link points.
    expect(action.description).toBe(
      'https://grafana.example.com/d/abc?var-service=checkout',
    );
    expect(action.url).toBe(
      'https://grafana.example.com/d/abc?var-service=checkout',
    );
    expect(action.external).toBe(true);
    expect(action.onClickError).toBeUndefined();
  });

  it('encodes an invalid external URL as url: null with an error handler', () => {
    const onClick: OnClickExternal = {
      type: 'external',
      urlTemplate: '/dashboards/{{Id}}',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    const action = result.current!({ Id: '123' });
    expect(action.url).toBeNull();
    expect(action.description).toBe('Open external link');
    expect(action.onClickError).toBeInstanceOf(Function);
  });

  it('caches results per row reference so repeated calls share the same RowAction', () => {
    const onClick: OnClickSearch = {
      type: 'search',
      target: { mode: 'id', id: 'src_1' },
      whereLanguage: 'sql',
    };
    const { result } = renderHook(() =>
      useOnClickLinkBuilder({ onClick, dateRange }),
    );
    const row = { ServiceName: 'web' };
    const first = result.current!(row);
    const second = result.current!(row);
    expect(first).toBe(second);
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
