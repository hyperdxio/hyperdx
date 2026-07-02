import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { Field } from '@hyperdx/common-utils/dist/core/metadata';
import { renderHook } from '@testing-library/react';

import { LuceneLanguageFormatter } from '@/components/SearchInput/SearchInputV2';
import {
  deriveMapColumnsFromFields,
  tokenizeAtCursor,
  useAutoCompleteOptions,
} from '@/hooks/useAutoCompleteOptions';
import { useGetKeyValues, useMultipleAllFields } from '@/hooks/useMetadata';

// Mock dependencies
jest.mock('../useMetadata', () => ({
  ...jest.requireActual('../useMetadata.tsx'),
  useMultipleAllFields: jest.fn(),
  useGetKeyValues: jest.fn(),
}));

jest.mock('../../source', () => ({
  useSource: jest.fn().mockReturnValue({ data: undefined }),
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

    (useGetKeyValues as jest.Mock).mockReturnValue({
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
    (useGetKeyValues as jest.Mock).mockReturnValue({
      data: [
        {
          key: 'ResourceAttributes.service.name',
          value: ['frontend', 'backend'],
        },
      ],
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

  it('should handle nested key value options', () => {
    (useGetKeyValues as jest.Mock).mockReturnValue({
      data: [
        {
          key: 'ResourceAttributes',
          value: [
            {
              'service.name': 'frontend',
              'deployment.environment': 'production',
            },
          ],
        },
      ],
      isFetching: false,
    });

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

describe('tokenizeAtCursor', () => {
  // Each case is tokenized with the cursor at the end of the input, so
  // `expectedToken` is the token the user is currently typing into.
  const cases: {
    name: string;
    input: string;
    expectedToken: string;
    expectedTokens: string[];
  }[] = [
    // Basic whitespace splitting
    {
      name: 'splits a bare whitespace-separated string into tokens',
      input: 'foo bar baz',
      expectedToken: 'baz',
      expectedTokens: ['foo', 'bar', 'baz'],
    },
    {
      name: 'returns a single token for input with no whitespace',
      input: 'FieldName',
      expectedToken: 'FieldName',
      expectedTokens: ['FieldName'],
    },
    {
      name: 'returns a single empty token for empty input',
      input: '',
      expectedToken: '',
      expectedTokens: [''],
    },
    {
      name: 'produces empty tokens for consecutive spaces (split-like semantics)',
      input: 'foo  bar',
      expectedToken: 'bar',
      expectedTokens: ['foo', '', 'bar'],
    },
    {
      name: 'produces a trailing empty token when input ends in a space',
      input: 'foo ',
      expectedToken: '',
      expectedTokens: ['foo', ''],
    },

    // Balanced quoted regions
    {
      name: 'keeps whitespace inside paired quotes as part of one token',
      input: 'Service:"hello world"',
      expectedToken: 'Service:"hello world"',
      expectedTokens: ['Service:"hello world"'],
    },
    {
      name: 'splits two paired-quote fields on the space between them',
      input: 'ServiceName:"clickhouse" SeverityText:"debug"',
      expectedToken: 'SeverityText:"debug"',
      expectedTokens: ['ServiceName:"clickhouse"', 'SeverityText:"debug"'],
    },
    {
      name: 'preserves escaped quotes inside a quoted region',
      input: 'Service:"he said \\"hi\\"" other',
      expectedToken: 'other',
      expectedTokens: ['Service:"he said \\"hi\\""', 'other'],
    },
    {
      name: 'treats a colon inside a quoted value as literal text',
      input: 'URL:"http://example.com/x" x',
      expectedToken: 'x',
      expectedTokens: ['URL:"http://example.com/x"', 'x'],
    },

    // Unclosed quotes — reproduces the bug where `Field:" Other:"v"` (three
    // quotes with the first unclosed) previously collapsed into one token.
    {
      name: 'breaks at whitespace when a quote is followed by a new field pattern',
      input: 'ServiceName:" SeverityText:"debug"',
      expectedToken: 'SeverityText:"debug"',
      expectedTokens: ['ServiceName:"', 'SeverityText:"debug"'],
    },
    {
      name: 'treats a single unclosed quote at end of input as a literal',
      input: 'Service:"hel',
      expectedToken: 'Service:"hel',
      expectedTokens: ['Service:"hel'],
    },
    {
      // No `ident:` after the space, so the quote can still legitimately
      // extend — but there's no closing quote anywhere, so it's unclosed.
      name: 'handles an unclosed quote followed by whitespace then bare text',
      input: 'Service:"hello world',
      expectedToken: 'world',
      expectedTokens: ['Service:"hello', 'world'],
    },
    {
      name: 'handles multiple unclosed quotes across fields',
      input: 'A:" B:" C:"done"',
      expectedToken: 'C:"done"',
      expectedTokens: ['A:"', 'B:"', 'C:"done"'],
    },

    // Identifier-like characters after whitespace
    {
      // The space inside the quoted value is followed by `!`, not `ident:`,
      // so the quote should still be able to close.
      name: 'does not bail out on whitespace followed by a non-identifier',
      input: 'Service:"hello !world"',
      expectedToken: 'Service:"hello !world"',
      expectedTokens: ['Service:"hello !world"'],
    },
    {
      name: 'does not treat whitespace + ident without colon as a new field',
      input: 'Service:"hello world done"',
      expectedToken: 'Service:"hello world done"',
      expectedTokens: ['Service:"hello world done"'],
    },
    {
      name: 'handles dotted identifiers in the new-field pattern',
      input: 'Foo:" ResourceAttributes.service.name:"x"',
      expectedToken: 'ResourceAttributes.service.name:"x"',
      expectedTokens: ['Foo:"', 'ResourceAttributes.service.name:"x"'],
    },
  ];

  it.each(cases)('$name', ({ input, expectedToken, expectedTokens }) => {
    const { token, tokens } = tokenizeAtCursor(input, input.length);
    expect(tokens).toEqual(expectedTokens);
    expect(token).toBe(expectedToken);
  });

  // Cursor-positioning is orthogonal to tokenization — keep these separate
  // because each case exercises a different cursor offset for the same input.
  describe('cursor positioning', () => {
    it('returns the first token when the cursor is at position 0', () => {
      const { token, index } = tokenizeAtCursor('foo bar baz', 0);
      expect(token).toBe('foo');
      expect(index).toBe(0);
    });

    it('returns the middle token when the cursor is inside it', () => {
      //               0123456789012
      // 'foo bar baz' — cursor at 5 is inside 'bar'
      const { token, index } = tokenizeAtCursor('foo bar baz', 5);
      expect(token).toBe('bar');
      expect(index).toBe(1);
    });

    it('returns the token whose range contains the cursor in a quoted field', () => {
      const input = 'Service:"hello world" other';
      // cursor inside the quoted token
      const { token, index } = tokenizeAtCursor(input, 15);
      expect(token).toBe('Service:"hello world"');
      expect(index).toBe(0);
    });

    it('returns the unclosed-quote token when the cursor is inside it', () => {
      // User is typing a value — the first quote is unclosed because the
      // next field pattern `SeverityText:` appears after whitespace. Cursor
      // sits just after `l`, inside the in-progress `ServiceName:"cl` token.
      const input = 'ServiceName:"cl SeverityText:"info"';
      const { token, index } = tokenizeAtCursor(input, 15);
      expect(token).toBe('ServiceName:"cl');
      expect(index).toBe(0);
    });
  });
});

// HDX-4369: pins the threading from "field list" -> "mapColumns" inside
// useAutoCompleteOptions. The hook uses the derived array as the third
// argument to mergePath when computing `searchKeys`, so a regression here
// silently re-introduces the illegal `Map[N+1]` SQL.
describe('deriveMapColumnsFromFields', () => {
  it('returns top-level Map column names', () => {
    const fields: Field[] = [
      { path: ['LogAttributes'], jsType: JSDataType.Map, type: 'map' },
      { path: ['ResourceAttributes'], jsType: JSDataType.Map, type: 'map' },
      {
        path: ['ServiceName'],
        jsType: JSDataType.String,
        type: 'String',
      },
    ];
    expect(deriveMapColumnsFromFields(fields)).toEqual([
      'LogAttributes',
      'ResourceAttributes',
    ]);
  });

  it('matches wrapped Map types via the canonical jsType', () => {
    // convertCHDataTypeToJSType peels off LowCardinality(...) and
    // Nullable(...) before classifying, so jsType is the canonical signal.
    // A raw-string check on f.type would miss these wrappers and silently
    // fall through to the array-index path in mergePath.
    const fields: Field[] = [
      {
        path: ['LowCardMap'],
        jsType: JSDataType.Map,
        type: 'LowCardinality(Map(String, String))',
      },
      {
        path: ['NullableMap'],
        jsType: JSDataType.Map,
        type: 'Nullable(Map(String, UInt8))',
      },
    ];
    expect(deriveMapColumnsFromFields(fields)).toEqual([
      'LowCardMap',
      'NullableMap',
    ]);
  });

  it('excludes nested fields (path.length > 1)', () => {
    // Sub-keys under a Map (e.g. ResourceAttributes.service.name) are not
    // themselves Map-typed parents; including them would change mergePath's
    // semantics for the outer column.
    const fields: Field[] = [
      { path: ['ResourceAttributes'], jsType: JSDataType.Map, type: 'Map' },
      {
        path: ['ResourceAttributes', 'service.name'],
        jsType: JSDataType.String,
        type: 'String',
      },
    ];
    expect(deriveMapColumnsFromFields(fields)).toEqual(['ResourceAttributes']);
  });

  it('excludes non-Map columns even when path.length === 1', () => {
    const fields: Field[] = [
      { path: ['BodyJson'], jsType: JSDataType.JSON, type: 'JSON' },
      { path: ['Timestamp'], jsType: JSDataType.Date, type: 'DateTime64(9)' },
      { path: ['Body'], jsType: JSDataType.String, type: 'String' },
    ];
    expect(deriveMapColumnsFromFields(fields)).toEqual([]);
  });

  it('handles undefined and empty inputs without throwing', () => {
    expect(deriveMapColumnsFromFields(undefined)).toEqual([]);
    expect(deriveMapColumnsFromFields([])).toEqual([]);
  });
});
