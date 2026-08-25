import { z } from 'zod';
import { Filter, FilterSchema } from '@hyperdx/common-utils/dist/types';

import { buildRRWebStreamChartConfig } from '@/sessions';
import { buildServiceScopeFilters } from '@/sessions';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

describe('buildRRWebStreamChartConfig', () => {
  // Mirrors useFieldExpressionGenerator's output for Map columns
  const getSessionSourceFieldExpression = (column: string, key: string) =>
    `${column}['${key}']`;

  const config = buildRRWebStreamChartConfig({
    source: {
      from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
      timestampValueExpression: 'TimestampTime',
      connection: 'test-connection',
    },
    serviceName: 'my-service',
    sessionId: 'session-1',
    startDate: new Date(1000),
    endDate: new Date(2000),
    limit: 1000000,
    offset: 0,
    getSessionSourceFieldExpression,
  });

  it('orders by timestamp with numeric offset and chunk tiebreaks', () => {
    // Chunks of one rrweb event share a single timestamp, so without the
    // tiebreaks ClickHouse can return them in arbitrary order and the replay
    // reassembly gets scrambled (hyperdxio/hyperdx#2569). The casts matter
    // too: the attributes are strings, and lexicographically '10' < '2'.
    expect(config.orderBy).toBe(
      "TimestampTime ASC, toUInt64OrZero(LogAttributes['rr-web.offset']) ASC, toUInt64OrZero(LogAttributes['rr-web.chunk']) ASC",
    );
  });

  it('selects the chunk metadata needed for reassembly', () => {
    expect(config.select).toEqual(
      expect.arrayContaining([
        { valueExpression: "LogAttributes['rr-web.chunk']", alias: 'ck' },
        {
          valueExpression: "LogAttributes['rr-web.total-chunks']",
          alias: 'tcks',
        },
        { valueExpression: "LogAttributes['rr-web.event']", alias: 'ev' },
      ]),
    );
  });

  it('scopes the query to the service and session', () => {
    expect(config.where).toBe(
      'ServiceName:"my-service" AND ResourceAttributes.rum.sessionId:"session-1"',
    );
    expect(config.dateRange).toEqual([new Date(1000), new Date(2000)]);
    expect(config.limit).toEqual({ limit: 1000000, offset: 0 });
  });
});

describe('buildServiceScopeFilters', () => {
  it('returns no filter for an empty service list (falls back to unscoped scan)', () => {
    expect(buildServiceScopeFilters([], 'ServiceName')).toEqual([]);
  });

  it('emits a single IN clause for one service', () => {
    expect(buildServiceScopeFilters(['svc-a'], 'ServiceName')).toEqual([
      { type: 'sql', condition: "ServiceName IN ('svc-a')" },
    ]);
  });

  it('comma-joins multiple services', () => {
    expect(buildServiceScopeFilters(['svc-a', 'svc-b'], 'ServiceName')).toEqual(
      [{ type: 'sql', condition: "ServiceName IN ('svc-a', 'svc-b')" }],
    );
  });

  it('honors a custom service-name expression', () => {
    expect(
      buildServiceScopeFilters(['svc-a'], "ResourceAttributes['service.name']"),
    ).toEqual([
      {
        type: 'sql',
        condition: "ResourceAttributes['service.name'] IN ('svc-a')",
      },
    ]);
  });

  describe('escaping ingested ServiceName values', () => {
    it('doubles single quotes', () => {
      expect(buildServiceScopeFilters(["o'brien"], 'ServiceName')).toEqual([
        { type: 'sql', condition: "ServiceName IN ('o''brien')" },
      ]);
    });

    it('escapes backslashes (which would otherwise produce invalid SQL)', () => {
      expect(buildServiceScopeFilters(['a\\b'], 'ServiceName')).toEqual([
        { type: 'sql', condition: "ServiceName IN ('a\\\\b')" },
      ]);
    });

    it('neutralizes a single-quote injection payload', () => {
      // `x') OR 1=1 --` must stay inside the literal: the quote is doubled so it
      // never terminates the string early.
      expect(
        buildServiceScopeFilters(["x') OR 1=1 --"], 'ServiceName'),
      ).toEqual([
        { type: 'sql', condition: "ServiceName IN ('x'') OR 1=1 --')" },
      ]);
    });

    it('neutralizes a backslash+quote injection payload', () => {
      // `x\') OR 1=1 --` relies on ClickHouse honoring backslash escapes; the
      // backslash is doubled first, then the quote, so the value stays inert.
      expect(
        buildServiceScopeFilters(["x\\') OR 1=1 --"], 'ServiceName'),
      ).toEqual([
        { type: 'sql', condition: "ServiceName IN ('x\\\\'') OR 1=1 --')" },
      ]);
    });
  });
});

describe('sessions ?filters= URL param', () => {
  // Mirror the parser wired up in SessionsPage: validate the shape and coerce
  // anything malformed to the empty default instead of white-screening.
  const filtersParser = parseAsJsonEncoded<Filter[]>(v =>
    z.array(FilterSchema).parse(v),
  ).withDefault([]);

  const encode = (value: unknown) => encodeURIComponent(JSON.stringify(value));

  it('parses a well-formed Filter[]', () => {
    const value: Filter[] = [{ type: 'sql', condition: "ServiceName = 'x'" }];
    expect(filtersParser.parse(encode(value))).toEqual(value);
  });

  it('falls back to an empty array (never null → never spreads a non-iterable)', () => {
    expect(filtersParser.defaultValue).toEqual([]);
  });

  it.each([
    ['a bare number (?filters=5)', 5],
    ['an empty object (?filters={})', {}],
    ['a bare string (?filters="x")', 'x'],
    ['a null literal', null],
    ['an array of malformed frames', [{ nope: true }]],
  ])('rejects %s so the default applies', (_label, input) => {
    expect(filtersParser.parse(encode(input))).toBeNull();
  });

  it('rejects invalid JSON', () => {
    expect(filtersParser.parse('not-json')).toBeNull();
  });
});
