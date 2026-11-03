import {
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';

import { getAdhocCellCondition } from '@/components/DBTable/adhocCellCondition';

const columnType = (type: string) => ({
  _type: convertCHDataTypeToJSType(type),
  type,
});

describe('getAdhocCellCondition', () => {
  it('filters scalar cells on the column', () => {
    expect(
      getAdhocCellCondition('ServiceName', columnType('String'), 'api', {}),
    ).toEqual({ key: 'ServiceName', value: 'api' });
    expect(
      getAdhocCellCondition('Duration', columnType('UInt64'), '42', {}),
    ).toEqual({ key: 'Duration', value: '42' });
    expect(
      getAdhocCellCondition('Day', columnType('Date'), '2026-10-15', {}),
    ).toEqual({ key: 'Day', value: '2026-10-15' });
  });

  it('filters on the expression behind an alias', () => {
    expect(
      getAdhocCellCondition('svc', columnType('String'), 'api', {
        svc: 'ServiceName',
      }),
    ).toEqual({ key: 'ServiceName', value: 'api' });
  });

  it('quotes column names that are not bare identifiers', () => {
    expect(
      getAdhocCellCondition('x-host-header', columnType('String'), 'h', {}),
    ).toEqual({ key: '`x-host-header`', value: 'h' });
  });

  it('unwraps Dynamic scalars from their JSON text', () => {
    const dynamic = columnType('Dynamic');
    expect(getAdhocCellCondition('json.service', dynamic, '"api"', {})).toEqual(
      { key: 'json.service', value: 'api' },
    );
    expect(getAdhocCellCondition('json.n', dynamic, '"5"', {})).toEqual({
      key: 'json.n',
      value: '5',
    });
    expect(getAdhocCellCondition('json.ok', dynamic, 'true', {})).toEqual({
      key: 'json.ok',
      value: 'true',
    });
  });

  it('offers no condition for Dynamic objects, arrays, or nulls', () => {
    const dynamic = columnType('Dynamic');
    expect(getAdhocCellCondition('json.o', dynamic, '{"a":1}', {})).toBe(
      undefined,
    );
    expect(getAdhocCellCondition('json.a', dynamic, '["a"]', {})).toBe(
      undefined,
    );
    expect(getAdhocCellCondition('json.x', dynamic, 'null', {})).toBe(
      undefined,
    );
  });

  it.each([
    'Array(String)',
    'Map(LowCardinality(String), String)',
    'Tuple(String, UInt8)',
    'JSON',
  ])('offers no condition for %s cells', type => {
    expect(getAdhocCellCondition('c', columnType(type), '["a"]', {})).toBe(
      undefined,
    );
  });

  it.each([
    'DateTime',
    "DateTime64(9, 'UTC')",
    'Nullable(DateTime64(3))',
    'LowCardinality(Nullable(DateTime))',
  ])('offers no condition for %s cells', type => {
    expect(
      getAdhocCellCondition(
        'Timestamp',
        { _type: JSDataType.Date, type },
        '2026-10-15T12:00:00Z',
        {},
      ),
    ).toBe(undefined);
  });

  it('offers no condition for null cells', () => {
    expect(
      getAdhocCellCondition('ServiceName', columnType('String'), null, {}),
    ).toBe(undefined);
  });
});
