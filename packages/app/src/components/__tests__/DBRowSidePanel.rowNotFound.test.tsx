import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
      parser && 'defaultValue' in parser ? parser.defaultValue : null,
      jest.fn(),
    ],
  };
});

const mockUseRowData = jest.fn();
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: (args: unknown) => mockUseRowData(args),
  ROW_DATA_ALIASES: {
    DURATION_MS: '__hdx_duration',
    SPAN_KIND: '__hdx_span_kind',
    SERVICE_NAME: '__hdx_service_name',
    SEVERITY_TEXT: '__hdx_severity_text',
  },
  rowHasK8sContext: () => false,
  RowDataPanel: () => null,
}));

jest.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  useSource: () => ({ data: undefined, isLoading: false, isSuccess: false }),
}));

jest.mock('../DBSessionPanel', () => ({
  __esModule: true,
  useSessionId: () => ({ rumSessionId: undefined, rumServiceName: undefined }),
  DBSessionPanel: () => null,
}));

jest.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));

jest.mock('../DBTracePanel', () => ({
  __esModule: true,
  default: () => <div data-testid="trace-panel" />,
}));
jest.mock('@/TabBar', () => ({
  __esModule: true,
  default: () => <div data-testid="tab-bar" />,
}));
jest.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBInfraPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../DBRowOverviewPanel', () => ({
  __esModule: true,
  RowOverviewPanel: () => null,
}));
jest.mock('../DBRowSidePanelErrorState', () => ({
  __esModule: true,
  DBRowSidePanelErrorState: () => null,
}));
jest.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../LogLevel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ServiceMap/ServiceMapSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../TimelineChart/utils', () => ({
  __esModule: true,
  renderMs: () => '',
}));
jest.mock('../DrawerUtils', () => ({
  __esModule: true,
  DrawerFullWidthToggle: () => null,
  INITIAL_DRAWER_WIDTH_PERCENT: 50,
}));
jest.mock('@/LogSidePanelElements', () => ({
  __esModule: true,
  KeyboardShortcutsModal: () => null,
}));
jest.mock('@/useFormatTime', () => ({
  __esModule: true,
  FormatTime: () => null,
}));

// NOTE: imported after the mock factories above.
import { DBRowSidePanelInner } from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const TRACE_SOURCE = { id: 'trace-src', kind: 'trace' } as TSource;

function Harness({ onClose }: { onClose: () => void }) {
  const sidePanelStack = useSidePanelStack({ initialRowId: 'row' });
  return (
    <DBRowSidePanelInner
      source={TRACE_SOURCE}
      rowId="row"
      aliasWith={[]}
      onClose={onClose}
      sidePanelStack={sidePanelStack}
    />
  );
}

describe('DBRowSidePanelInner — row lookup returns no rows', () => {
  beforeEach(() => {
    mockUseRowData.mockReset().mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isSuccess: true,
      isError: false,
      error: null,
    });
  });

  it('shows a not-found state instead of the tabs', () => {
    const onClose = jest.fn();
    render(
      <MantineProvider>
        <Harness onClose={onClose} />
      </MantineProvider>,
    );

    expect(screen.getByText('Event not found')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trace-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Back'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
