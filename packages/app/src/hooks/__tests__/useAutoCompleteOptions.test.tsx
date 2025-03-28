import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { Field } from '@hyperdx/common-utils/dist/metadata';
import { renderHook } from '@testing-library/react';

import { LuceneLanguageFormatter } from '../../SearchInputV2';
import { useAutoCompleteOptions } from '../useAutoCompleteOptions';
import { useAllFields, useGetKeyValues } from '../useMetadata';

if (!globalThis.structuredClone) {
  globalThis.structuredClone = (obj: any) => {
    return JSON.parse(JSON.stringify(obj));
  }
}

// Mock dependencies
jest.mock('../useMetadata', () => ({
  ...jest.requireActual('../useMetadata.tsx'),
  useAllFields: jest.fn(),
  useGetKeyValues: jest.fn(),
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

const mockTableConnections = [
  {
    databaseName: 'test_db',
    tableName: 'traces',
    connectionId: 'conn1',
  },
];

describe('useAutoCompleteOptions', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup default mock implementations
    (useAllFields as jest.Mock).mockReturnValue({
      data: mockFields,
    });

    (useGetKeyValues as jest.Mock).mockReturnValue({
      data: null,
    });
  });

  it('should return field options with correct lucene formatting', () => {
    const { result } = renderHook(() =>
      useAutoCompleteOptions(luceneFormatter, 'ResourceAttributes', {
        tableConnections: mockTableConnections,
      }),
    );

    expect(result.current).toEqual([
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
    const mockKeyValues = [
      {
        key: 'ResourceAttributes.service.name',
        value: ['frontend', 'backend'],
      },
    ];

    (useGetKeyValues as jest.Mock).mockReturnValue({
      data: mockKeyValues,
    });

    const { result } = renderHook(() =>
      useAutoCompleteOptions(
        luceneFormatter,
        'ResourceAttributes.service.name',
        {
          tableConnections: mockTableConnections,
        },
      ),
    );

    expect(result.current).toEqual([
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

  // TODO: Does this test case need to be removed after HDX-1548?
  it('should handle nested key value options', () => {
    const mockKeyValues = [
      {
        key: 'ResourceAttributes',
        value: [
          {
            'service.name': 'frontend',
            'deployment.environment': 'production',
          },
        ],
      },
    ];

    (useGetKeyValues as jest.Mock).mockReturnValue({
      data: mockKeyValues,
    });

    const { result } = renderHook(() =>
      useAutoCompleteOptions(luceneFormatter, 'ResourceAttributes', {
        tableConnections: mockTableConnections,
      }),
    );

    //console.log(result.current);
    expect(result.current).toEqual([
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
        value: 'ResourceAttributes.deployment.environment:"production"',
        label: 'ResourceAttributes.deployment.environment:"production"',
      },
    ]);
  });

  it('should handle additional suggestions', () => {
    const { result } = renderHook(() =>
      useAutoCompleteOptions(luceneFormatter, 'ResourceAttributes', {
        tableConnections: mockTableConnections,
        additionalSuggestions: ['custom.field'],
      }),
    );

    expect(result.current).toEqual([
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
