import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { Field } from '@hyperdx/common-utils/dist/core/metadata';
import { renderHook } from '@testing-library/react';

import { LuceneLanguageFormatter } from '../../components/SearchInput/SearchInputV2';
import { useAutoCompleteOptions } from '../useAutoCompleteOptions';
import { useCompleteKeyValues, useMultipleAllFields } from '../useMetadata';

// Mock dependencies
jest.mock('../useMetadata', () => ({
  ...jest.requireActual('../useMetadata.tsx'),
  useMultipleAllFields: jest.fn(),
  useCompleteKeyValues: jest.fn(),
}));

const luceneFormatter = new LuceneLanguageFormatter();

const mockFields: Field[] = [
  {
    path: ['ResourceAttributes'],
    jsType: JSDataType.Map,
    type: 'map',
  },
  {
    path: ['ResourceAttributes', 'service.name'],
    jsType: JSDataType.String,
    type: 'string',
  },
  {
    path: ['TraceAttributes', 'trace.id'],
    jsType: JSDataType.String,
    type: 'string',
  },
];

const mockTableConnection = {
  databaseName: 'test_db',
  tableName: 'traces',
  connectionId: 'conn1',
};

describe('useAutoCompleteOptions', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup default mock implementations
    (useMultipleAllFields as jest.Mock).mockReturnValue({
      data: mockFields,
    });

    (useCompleteKeyValues as jest.Mock).mockReturnValue({
      data: null,
      isFetching: false,
    });
  });

  it('should return field options with correct lucene formatting', () => {
    const { result } = renderHook(() =>
      useAutoCompleteOptions(luceneFormatter, 'ResourceAttributes', {
        tableConnection: mockTableConnection,
      }),
    );

    expect(result.current.options).toEqual([
      {
        value: 'ResourceAttributes',
        label: 'ResourceAttributes (map)',
      },
      {
        value: 'ResourceAttributes.service.name',
        label: 'ResourceAttributes.service.name (string)',
      },
      {
        value: 'TraceAttributes.trace.id',
        label: 'TraceAttributes.trace.id (string)',
      },
    ]);
  });

  it('should return key value options with correct lucene formatting', () => {
    (useCompleteKeyValues as jest.Mock).mockReturnValue({
      data: ['frontend', 'backend'],
      isFetching: false,
    });

    const { result } = renderHook(() =>
      useAutoCompleteOptions(
        luceneFormatter,
        'ResourceAttributes.service.name',
        {
          tableConnection: mockTableConnection,
        },
      ),
    );

    expect(result.current.options).toEqual([
      {
        value: 'ResourceAttributes',
        label: 'ResourceAttributes (map)',
      },
      {
        value: 'ResourceAttributes.service.name',
        label: 'ResourceAttributes.service.name (string)',
      },
      {
        value: 'TraceAttributes.trace.id',
        label: 'TraceAttributes.trace.id (string)',
      },
      {
        value: 'ResourceAttributes.service.name:"frontend"',
        label: 'ResourceAttributes.service.name:"frontend"',
      },
      {
        value: 'ResourceAttributes.service.name:"backend"',
        label: 'ResourceAttributes.service.name:"backend"',
      },
    ]);
  });

  it('should handle additional suggestions', () => {
    const { result } = renderHook(() =>
      useAutoCompleteOptions(luceneFormatter, 'ResourceAttributes', {
        tableConnection: mockTableConnection,
        additionalSuggestions: ['custom.field'],
      }),
    );

    expect(result.current.options).toEqual([
      {
        value: 'ResourceAttributes',
        label: 'ResourceAttributes (map)',
      },
      {
        value: 'ResourceAttributes.service.name',
        label: 'ResourceAttributes.service.name (string)',
      },
      {
        value: 'TraceAttributes.trace.id',
        label: 'TraceAttributes.trace.id (string)',
      },
      {
        value: 'custom.field',
        label: 'custom.field',
      },
    ]);
  });
});
