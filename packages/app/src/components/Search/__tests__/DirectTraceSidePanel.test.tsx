import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import DirectTraceSidePanel from '../DirectTraceSidePanel';

let mockSources: Record<string, any> = {};
let mockIsLoading = false;

jest.mock('@/source', () => ({
  useSource: ({ id }: { id?: string | null }) => ({
    data: id ? mockSources[id] : undefined,
    isLoading: mockIsLoading,
  }),
}));

jest.mock('@/components/DBTracePanel', () => ({
  __esModule: true,
  default: ({ traceId }: { traceId: string }) => (
    <div>trace panel {traceId}</div>
  ),
}));

jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div>source select</div>,
}));

describe('DirectTraceSidePanel', () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockSources = {
      'trace-source': {
        id: 'trace-source',
        kind: SourceKind.Trace,
        name: 'Trace Source',
        logSourceId: 'log-source',
      },
    };
  });

  it('renders DBTracePanel when the selected trace source is valid', () => {
    renderWithMantine(
      <DirectTraceSidePanel
        opened={true}
        traceId="trace-123"
        traceSourceId="trace-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        onClose={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByText('trace panel trace-123')).toBeInTheDocument();
  });

  it('shows a source selection empty state when no source is selected', () => {
    renderWithMantine(
      <DirectTraceSidePanel
        opened={true}
        traceId="trace-123"
        traceSourceId={null}
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        onClose={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Select a trace source')).toBeInTheDocument();
  });

  it('shows a not found source state for an invalid source id', () => {
    renderWithMantine(
      <DirectTraceSidePanel
        opened={true}
        traceId="trace-123"
        traceSourceId="missing-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        onClose={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Trace source not found')).toBeInTheDocument();
  });

  it('shows a loading state while the trace source is being resolved', () => {
    mockIsLoading = true;
    mockSources = {};

    renderWithMantine(
      <DirectTraceSidePanel
        opened={true}
        traceId="trace-123"
        traceSourceId="trace-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        onClose={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Loading trace source')).toBeInTheDocument();
  });

  it('renders a visible close button', () => {
    renderWithMantine(
      <DirectTraceSidePanel
        opened={true}
        traceId="trace-123"
        traceSourceId={null}
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        onClose={jest.fn()}
        onSourceChange={jest.fn()}
      />,
    );

    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
