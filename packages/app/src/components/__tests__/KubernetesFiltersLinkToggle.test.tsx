import type { TMetricSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { KubernetesFilters } from '@/components/KubernetesFilters';
import { useGetKeyValues } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useGetKeyValues: jest.fn(),
}));

// Pulls in networked editors; the toggle behavior doesn't need it.
jest.mock('@/components/SearchInput/SearchInputV2', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedUseGetKeyValues = jest.mocked(useGetKeyValues);

const K8S_STORAGE_KEY = 'hdx-k8s-filters-linked';
const DASHBOARD_STORAGE_KEY = 'hdx-dashboard-filters-linked';

// useGetKeyValues is mocked, so this only needs to satisfy the prop type.
const METRIC_SOURCE = {
  id: 'metrics',
  kind: 'metric',
  name: 'Metrics',
  connection: 'conn',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { gauge: 'otel_metrics_gauge' },
} as unknown as TMetricSource;

function renderK8sFilters() {
  return renderWithMantine(
    <KubernetesFilters
      dateRange={[
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-02T00:00:00Z'),
      ]}
      metricSource={METRIC_SOURCE}
      searchQuery=""
      setSearchQuery={jest.fn()}
    />,
  );
}

describe('KubernetesFilters link toggle persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedUseGetKeyValues.mockClear();
    mockedUseGetKeyValues.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useGetKeyValues>);
  });

  it('defaults to unlinked and requests values without per-key conditions', () => {
    renderK8sFilters();

    expect(screen.getByTestId('k8s-filters-link-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mockedUseGetKeyValues.mock.calls[0][0]).toMatchObject({
      keyConditions: undefined,
    });
  });

  it('reads a persisted preference and facets the first values request', () => {
    window.localStorage.setItem(K8S_STORAGE_KEY, JSON.stringify(true));

    renderK8sFilters();

    expect(screen.getByTestId('k8s-filters-link-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(mockedUseGetKeyValues.mock.calls[0][0].keyConditions).toBeDefined();
  });

  it('persists toggle changes under its own key, leaving the dashboard preference alone', async () => {
    renderK8sFilters();

    await userEvent.click(screen.getByTestId('k8s-filters-link-toggle'));

    expect(window.localStorage.getItem(K8S_STORAGE_KEY)).toBe('true');
    expect(window.localStorage.getItem(DASHBOARD_STORAGE_KEY)).toBeNull();
  });
});
