import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import DBTracePanel from '@/components/DBTracePanel';

let mockSources: Record<string, any> = {};

jest.mock('nuqs', () => ({
  useQueryState: () => [null, jest.fn()],
}));

jest.mock('@/utils/queryParsers', () => ({
  parseAsJsonEncoded: () => 'parseAsJsonEncoded',
}));

jest.mock('@/source', () => ({
  useSource: ({ id }: { id?: string | null }) => ({
    data: id ? mockSources[id] : undefined,
    isLoading: false,
  }),
  useUpdateSource: () => ({
    mutate: jest.fn(),
  }),
}));

jest.mock('@/components/DBTraceWaterfallChart', () => ({
  DBTraceWaterfallChartContainer: ({
    emptyState,
  }: {
    emptyState?: React.ReactNode;
  }) => <div>{emptyState ?? 'waterfall'}</div>,
}));

jest.mock('../SourceSelect', () => ({
  SourceSelectControlled: () => <div>source select</div>,
}));

// useRowData runs unconditionally (for the Infrastructure tab / k8s detection)
// and would otherwise need a QueryClient provider; stub it for this unit test.
jest.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: undefined }),
  RowDataPanel: () => <div>row data panel</div>,
}));

jest.mock('../DBInfraPanel', () => ({
  __esModule: true,
  default: () => <div>infra panel</div>,
}));

jest.mock('../SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => <div />,
  isSourceSchemaPreviewEnabled: () => false,
  getSourceSchemaTables: () => [],
}));

describe('DBTracePanel', () => {
  beforeEach(() => {
    mockSources = {
      'trace-source': {
        id: 'trace-source',
        kind: SourceKind.Trace,
        traceIdExpression: 'TraceId',
        logSourceId: 'log-source',
      },
      'log-source': {
        id: 'log-source',
        kind: SourceKind.Log,
        traceIdExpression: 'TraceId',
      },
    };
  });

  it('passes through a custom empty state to the waterfall container', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        emptyState={<div>Trace not found</div>}
      />,
    );

    expect(screen.getByText('Trace not found')).toBeInTheDocument();
  });
});
