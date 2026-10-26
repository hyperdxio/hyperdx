import React from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import { COMPACT_MAX_WIDTH } from '@/components/CompactViewport/useCompactViewport';
import { useWindowSize } from '@/utils';

jest.mock('nuqs', () => ({
  ...jest.requireActual('nuqs'),
  useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
    parser && 'defaultValue' in parser ? parser.defaultValue : null,
    jest.fn(),
  ],
}));

jest.mock('@/utils', () => ({
  ...jest.requireActual('@/utils'),
  useWindowSize: jest.fn(() => ({ width: undefined, height: undefined })),
}));

// The panel body stays on "Loading..."; only the drawer around it is under
// test.
jest.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: () => ({
    data: undefined,
    isLoading: true,
    isSuccess: false,
    isError: false,
    error: null,
  }),
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
jest.mock('../DBTracePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../DBInfraPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../ServiceMap/ServiceMapSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));

import DBRowSidePanel from '@/components/DBRowSidePanel';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const SOURCE = { id: 'log-src', kind: 'log' } as TSource;

const setWidth = (width: number) =>
  jest.mocked(useWindowSize).mockReturnValue({ width, height: 800 });

const renderPanel = () =>
  render(
    <MantineProvider>
      <DBRowSidePanel
        source={SOURCE}
        rowId="row-1"
        aliasWith={[]}
        onClose={jest.fn()}
      />
    </MantineProvider>,
  );

// Mantine sets the drawer width as a CSS variable on the drawer root.
const drawerSize = () =>
  screen
    .getByTestId('row-side-panel')
    .closest('.mantine-Drawer-root')
    ?.getAttribute('style') ?? '';

describe('DBRowSidePanel', () => {
  it('opens full width without a resize handle below the compact width', () => {
    setWidth(COMPACT_MAX_WIDTH - 1);
    renderPanel();
    const panel = screen.getByTestId('row-side-panel');
    expect(drawerSize()).toContain('--drawer-size: 100vw');
    expect(panel.querySelector('.panelDragBar')).toBeNull();
  });

  it('keeps the resizable width and the resize handle at the compact width', () => {
    setWidth(COMPACT_MAX_WIDTH);
    renderPanel();
    const panel = screen.getByTestId('row-side-panel');
    expect(drawerSize()).not.toContain('100vw');
    expect(drawerSize()).toMatch(/--drawer-size: \d+vw/);
    expect(panel.querySelector('.panelDragBar')).not.toBeNull();
  });
});
