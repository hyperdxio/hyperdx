import React from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import { DBRowSidePanelErrorState } from '@/components/DBRowSidePanelErrorState';

// The hint only renders when the target table is a Distributed/Merge pointer
// table; drive that via the metadata hook.
const mockUseTableMetadata = jest.fn();
jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useTableMetadata: (...args: unknown[]) => mockUseTableMetadata(...args),
}));

// Non-local mode so the source-settings link (not the inline edit modal /
// TableSourceForm) is rendered, keeping the module graph cheap.
jest.mock('@/config', () => ({
  __esModule: true,
  IS_LOCAL_MODE: false,
}));

jest.mock('../ChartSQLPreview', () => ({
  __esModule: true,
  SQLPreview: ({ data }: { data?: string }) => <pre>{data}</pre>,
}));

jest.mock('../Sources/SourceForm', () => ({
  __esModule: true,
  TableSourceForm: () => null,
}));

const source: TLogSource = {
  id: 'source-id',
  kind: SourceKind.Log,
  name: 'logs',
  connection: 'conn-id',
  from: { databaseName: 'default', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
};

function renderErrorState(error: Error, src: TLogSource = source) {
  return render(
    <MantineProvider>
      <DBRowSidePanelErrorState error={error} source={src} />
    </MantineProvider>,
  );
}

describe('DBRowSidePanelErrorState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTableMetadata.mockReturnValue({ data: { isPointerTable: true } });
  });

  it('renders the raw error message and sent query for a ClickHouse error', () => {
    const error = new ClickHouseQueryError(
      'There is no column with name Foo',
      'SELECT * FROM logs',
    );
    renderErrorState(error);

    expect(screen.getByText('There is no column with name Foo')).toBeTruthy();
    expect(screen.getByText('SELECT * FROM logs')).toBeTruthy();
  });

  it('shows the SELECT * hint for a missing-column error on a pointer table', () => {
    const error = new ClickHouseQueryError(
      'Missing columns: Foo while processing query',
      'SELECT * FROM logs',
    );
    renderErrorState(error);

    expect(
      screen.getByText(
        /Couldn't load the full row from a Distributed or Merge table/i,
      ),
    ).toBeTruthy();
    // Explains WHY HyperDX issues SELECT * in the first place.
    expect(
      screen.getByText(/To show every field for a row, HyperDX loads/i),
    ).toBeTruthy();
    expect(screen.getByText('Edit source settings')).toBeTruthy();
  });

  it('tailors the hint when a Known Columns List is already configured', () => {
    const error = new ClickHouseQueryError(
      'Missing columns: Foo while processing query',
      'SELECT Timestamp, Body FROM logs',
    );
    renderErrorState(error, {
      ...source,
      knownColumnsListExpression: 'Timestamp, Body',
    });

    expect(screen.getByText(/loads the full row using the/i)).toBeTruthy();
    expect(screen.getAllByText(/Known Columns List/i).length).toBeGreaterThan(
      0,
    );
  });

  it('does not show the hint when the table is not a pointer table', () => {
    mockUseTableMetadata.mockReturnValue({ data: { isPointerTable: false } });
    const error = new ClickHouseQueryError(
      'Missing columns: Foo while processing query',
      'SELECT * FROM logs',
    );
    renderErrorState(error);

    expect(
      screen.queryByText(
        /Couldn't load the full row from a Distributed or Merge table/i,
      ),
    ).toBeNull();
  });

  it('does not show the hint for unrelated errors even on a pointer table', () => {
    const error = new ClickHouseQueryError(
      'Some unrelated failure',
      'SELECT * FROM logs',
    );
    renderErrorState(error);

    expect(
      screen.queryByText(
        /Couldn't load the full row from a Distributed or Merge table/i,
      ),
    ).toBeNull();
  });
});
