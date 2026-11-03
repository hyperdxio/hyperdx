import { ColumnMeta, JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { Field } from '@hyperdx/common-utils/dist/core/metadata';
import { renderHook } from '@testing-library/react';

import { useClauseFieldOptions } from '@/components/SearchResultsToolbar/useClauseFieldOptions';
import { useAllFields } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  useAllFields: jest.fn(),
}));

const column = (name: string, type: string): ColumnMeta => ({
  name,
  type,
  codec_expression: '',
  comment: '',
  default_expression: '',
  default_type: '',
  ttl_expression: '',
});

const columns = [
  column('ServiceName', 'LowCardinality(String)'),
  column('Timestamp', 'DateTime64(9)'),
  column('service-name', 'String'),
  column('my-map', 'Map(String, String)'),
];

function mockAllFields(
  data: Field[] | undefined,
  isFieldMetadataDisabled: boolean,
) {
  const result: ReturnType<typeof useAllFields> = {
    data,
    error: null,
    isError: false,
    isPending: false,
    isSuccess: true,
    isLoading: false,
    isFetching: false,
    isFieldMetadataDisabled,
    fieldsByTableConnection: new Map(),
    columnsByTableConnection: new Map(),
    errorsByTableConnection: new Map(),
    refetch: () => Promise.reject(new Error('unused')),
  };
  jest.mocked(useAllFields).mockReturnValue(result);
}

describe('useClauseFieldOptions', () => {
  it('quotes column names that are not bare identifiers', () => {
    mockAllFields(
      [
        { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
        {
          path: ['Timestamp'],
          type: 'DateTime64(9)',
          jsType: JSDataType.Date,
        },
        { path: ['service-name'], type: 'String', jsType: JSDataType.String },
        { path: ['my-map', 'k'], type: 'String', jsType: null },
      ],
      false,
    );

    const { result } = renderHook(() =>
      useClauseFieldOptions({ tableConnection: undefined, columns }),
    );

    expect(result.current).toEqual([
      'ServiceName',
      'Timestamp',
      "`my-map`['k']",
      '`service-name`',
    ]);
  });

  it('offers scalar columns when field metadata is disabled', () => {
    mockAllFields([], true);

    const { result } = renderHook(() =>
      useClauseFieldOptions({ tableConnection: undefined, columns }),
    );

    expect(result.current).toEqual([
      'ServiceName',
      'Timestamp',
      '`service-name`',
    ]);
  });
});
