import React from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

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
        /Failed to load row details from distributed or merge table/i,
      ),
    ).toBeTruthy();
    // Explains WHY HyperDX issues SELECT * in the first place.
    expect(
      screen.getByText(/To show every field for this row, HyperDX loads/i),
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
        /Failed to load row details from distributed or merge table/i,
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
        /Failed to load row details from distributed or merge table/i,
      ),
    ).toBeNull();
  });

  describe('materialized and alias columns hint', () => {
    const OPTION_KEY = 'hdx-row-show-materialized-alias-columns';
    const aliasError = new ClickHouseQueryError(
      "Dictionary ('default.missing') not found",
      'SELECT * FROM logs LIMIT 1 SETTINGS asterisk_include_alias_columns = 1',
    );

    beforeEach(() => {
      localStorage.clear();
    });

    it('offers to hide the columns when the row query added them', () => {
      localStorage.setItem(OPTION_KEY, 'true');
      renderErrorState(aliasError);

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Hide materialized and alias columns',
        }),
      );

      expect(localStorage.getItem(OPTION_KEY)).toBe('false');
      expect(
        screen.queryByTestId('materialized-alias-columns-hint'),
      ).toBeNull();
    });

    it('is not shown while the option is off', () => {
      renderErrorState(aliasError);

      expect(
        screen.queryByTestId('materialized-alias-columns-hint'),
      ).toBeNull();
    });

    it('is not shown when the source sets both settings itself', () => {
      localStorage.setItem(OPTION_KEY, 'true');
      renderErrorState(aliasError, {
        ...source,
        querySettings: [
          { setting: 'asterisk_include_materialized_columns', value: '0' },
          { setting: 'asterisk_include_alias_columns', value: '0' },
        ],
      });

      expect(
        screen.queryByTestId('materialized-alias-columns-hint'),
      ).toBeNull();
    });

    it('is not shown when a Known Columns List replaces SELECT *', () => {
      localStorage.setItem(OPTION_KEY, 'true');
      renderErrorState(aliasError, {
        ...source,
        knownColumnsListExpression: 'Timestamp, Body',
      });

      expect(
        screen.queryByTestId('materialized-alias-columns-hint'),
      ).toBeNull();
    });
  });
});
