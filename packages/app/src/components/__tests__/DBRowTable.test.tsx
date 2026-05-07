import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RawLogTable } from '@/components/DBRowTable';
import { RowWhereResult } from '@/hooks/useRowWhere';

import * as useChartConfigModule from '../../hooks/useChartConfig';

const mockRowWhereResult: RowWhereResult = { where: '', aliasWith: [] };

describe('RawLogTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(useChartConfigModule, 'useAliasMapFromChartConfig')
      .mockReturnValue({
        data: {},
        isLoading: false,
        error: null,
      } as any);

    // Suppress console errors for expected errors in tests. Keeps the test output clean.
    jest.spyOn(console, 'error').mockImplementation(() => {
      /* noop */
    });
  });

  it('should render no results message when no results found', async () => {
    renderWithMantine(
      <RawLogTable
        displayedColumns={['col1', 'col2']}
        rows={[]}
        isLoading={false}
        dedupRows={false}
        hasNextPage={false}
        onRowDetailsClick={() => {}}
        generateRowId={() => mockRowWhereResult}
        columnTypeMap={new Map()}
      />,
    );

    expect(await screen.findByTestId('db-row-table-no-results')).toBeTruthy();
  });

  describe('Sorting', () => {
    const baseProps = {
      displayedColumns: ['col1', 'col2'],
      rows: [
        {
          col1: 'value1',
          col2: 'value2',
        },
      ],
      isLoading: false,
      dedupRows: false,
      hasNextPage: false,
      onRowDetailsClick: () => {},
      generateRowId: () => mockRowWhereResult,
      columnTypeMap: new Map(),
    };
    it('Should not allow changing sort if disabled', () => {
      renderWithMantine(<RawLogTable {...baseProps} />);

      expect(
        screen.queryByTestId('raw-log-table-sort-button'),
      ).not.toBeInTheDocument();
    });

    it('Should allow changing sort', async () => {
      const callback = jest.fn();

      renderWithMantine(
        <RawLogTable {...baseProps} enableSorting onSortingChange={callback} />,
      );

      const sortElements = await screen.findAllByTestId(
        'raw-log-table-sort-button',
      );
      expect(sortElements).toHaveLength(2);

      await userEvent.click(sortElements.at(0)!);

      expect(callback).toHaveBeenCalledWith([
        {
          desc: false,
          id: 'col1',
        },
      ]);
    });

    it('Should show sort indicator', async () => {
      renderWithMantine(
        <RawLogTable
          {...baseProps}
          enableSorting
          sortOrder={[
            {
              desc: false,
              id: 'col1',
            },
          ]}
        />,
      );

      const sortElements = await screen.findByTestId(
        'raw-log-table-sort-indicator',
      );
      expect(sortElements).toBeInTheDocument();
      expect(sortElements).toHaveClass('sorted-asc');
    });

    it('Should reference alias map when possible', async () => {
      jest
        .spyOn(useChartConfigModule, 'useAliasMapFromChartConfig')
        .mockReturnValue({
          data: {
            col1: 'col1_alias',
            col2: 'col2_alias',
          },
          isLoading: false,
          error: null,
        } as any);

      const callback = jest.fn();
      renderWithMantine(
        <RawLogTable {...baseProps} enableSorting onSortingChange={callback} />,
      );
      const sortElements = await screen.findAllByTestId(
        'raw-log-table-sort-button',
      );
      expect(sortElements).toHaveLength(2);

      await userEvent.click(sortElements.at(0)!);

      expect(callback).toHaveBeenCalledWith([
        {
          desc: false,
          id: '"col1"',
        },
      ]);
    });
  });
});
