import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  appendSelectWithPrimaryAndPartitionKey,
  RawLogTable,
} from '@/components/DBRowTable';

import * as useChartConfigModule from '../../hooks/useChartConfig';

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
        generateRowId={() => ''}
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
      generateRowId: () => '',
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

describe('appendSelectWithPrimaryAndPartitionKey', () => {
  it('should extract columns from partition key with nested function call', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      'id, created_at',
      ' toStartOfInterval(timestamp, toIntervalDay(3))',
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: 'col1,col2,timestamp,id,created_at',
    });
  });

  it('should extract no columns from empty primary key and partition key', () => {
    const result = appendSelectWithPrimaryAndPartitionKey('col1, col2', '', '');
    expect(result).toEqual({
      additionalKeysLength: 0,
      select: 'col1,col2',
    });
  });

  it('should extract columns from complex primary key', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      'id, timestamp, toStartOfInterval(timestamp2, toIntervalDay(3))',
      "toStartOfInterval(timestamp, toIntervalDay(3)), date_diff('DAY', col3, col4), now(), toDate(col5 + INTERVAL 1 DAY)",
    );
    expect(result).toEqual({
      additionalKeysLength: 6,
      select: 'col1,col2,timestamp,col3,col4,col5,id,timestamp2',
    });
  });

  it('should extract map columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `map['key']`,
      `map2['key'], map1['key3 ']`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,map2['key'],map1['key3 '],map['key']`,
    });
  });

  it('should extract map columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      ``,
      `map2['key.2']`,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,map2['key.2']`,
    });
  });

  it('should extract array columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `array[1]`,
      `array[2], array[3]`,
    );
    expect(result).toEqual({
      additionalKeysLength: 3,
      select: `col1,col2,array[2],array[3],array[1]`,
    });
  });

  it('should extract json columns', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b`,
      `json.a, json.b.c, toStartOfDay(timestamp, json_2.d)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 5,
      select: `col1,col2,json.a,json.b.c,timestamp,json_2.d,json.b`,
    });
  });

  it('should extract json columns with type specifiers', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b.:Int64`,
      `toStartOfDay(json.a.b.:DateTime)`,
    );
    expect(result).toEqual({
      additionalKeysLength: 2,
      select: `col1,col2,json.a.b,json.b`,
    });
  });

  it('should skip json columns with hard-to-parse type specifiers', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `json.b.:Array(String), col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,col3`,
    });
  });

  it('should skip nested map references', () => {
    const result = appendSelectWithPrimaryAndPartitionKey(
      'col1, col2',
      `map['key']['key2'], col3`,
      ``,
    );
    expect(result).toEqual({
      additionalKeysLength: 1,
      select: `col1,col2,col3`,
    });
  });
});
