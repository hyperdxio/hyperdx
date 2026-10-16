import { ColumnMeta, JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
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
  column('service-name', 'String'),
  column('my-map', 'Map(String, String)'),
];

describe('useClauseFieldOptions', () => {
  it('quotes column names that are not bare identifiers', () => {
    jest.mocked(useAllFields).mockReturnValue({
      data: [
        { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
        { path: ['service-name'], type: 'String', jsType: JSDataType.String },
        { path: ['my-map', 'k'], type: 'String', jsType: null },
      ],
      isFieldMetadataDisabled: false,
    } as unknown as ReturnType<typeof useAllFields>);

    const { result } = renderHook(() =>
      useClauseFieldOptions({ tableConnection: undefined, columns }),
    );

    expect(result.current).toEqual([
      'ServiceName',
      "`my-map`['k']",
      '`service-name`',
    ]);
  });

  it('offers scalar columns when field metadata is disabled', () => {
    jest.mocked(useAllFields).mockReturnValue({
      data: [],
      isFieldMetadataDisabled: true,
    } as unknown as ReturnType<typeof useAllFields>);

    const { result } = renderHook(() =>
      useClauseFieldOptions({ tableConnection: undefined, columns }),
    );

    expect(result.current).toEqual(['ServiceName', '`service-name`']);
  });
});
