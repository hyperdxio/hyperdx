import {
  isDenylisted,
  isHighCardinality,
  isIdField,
  isTimestampArrayField,
  stripTypeWrappers,
} from '../deltaChartUtils';

const traceColumnMeta = [
  { name: 'Timestamp', type: 'DateTime64(9)' },
  { name: 'TraceId', type: 'String' },
  { name: 'SpanId', type: 'String' },
  { name: 'ParentSpanId', type: 'String' },
  { name: 'ResourceAttributes', type: 'Map(String, String)' },
  { name: 'SpanAttributes', type: 'Map(String, String)' },
  { name: 'Events.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Events.Name', type: 'Array(String)' },
  { name: 'Events.Attributes', type: 'Array(Map(String, String))' },
  { name: 'Links.TraceId', type: 'Array(String)' },
  { name: 'Links.SpanId', type: 'Array(String)' },
  { name: 'Links.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Links.Attributes', type: 'Array(Map(String, String))' },
];

describe('stripTypeWrappers', () => {
  it('removes LowCardinality wrapper', () => {
    expect(stripTypeWrappers('LowCardinality(String)')).toBe('String');
  });

  it('removes Nullable wrapper', () => {
    expect(stripTypeWrappers('Nullable(String)')).toBe('String');
  });

  it('removes nested wrappers', () => {
    expect(stripTypeWrappers('LowCardinality(Nullable(String))')).toBe(
      'String',
    );
  });

  it('returns unwrapped type as-is', () => {
    expect(stripTypeWrappers('String')).toBe('String');
    expect(stripTypeWrappers('Array(String)')).toBe('Array(String)');
  });
});

describe('isIdField', () => {
  it('identifies top-level String columns ending in Id', () => {
    expect(isIdField('TraceId', traceColumnMeta)).toBe(true);
    expect(isIdField('SpanId', traceColumnMeta)).toBe(true);
    expect(isIdField('ParentSpanId', traceColumnMeta)).toBe(true);
  });

  it('identifies Array(String) column elements ending in Id', () => {
    expect(isIdField('Links.TraceId[0]', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.SpanId[0]', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.TraceId[5]', traceColumnMeta)).toBe(true);
  });

  it('identifies plain Array(String) column reference ending in Id', () => {
    expect(isIdField('Links.TraceId', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.SpanId', traceColumnMeta)).toBe(true);
  });

  it('does not match non-ID String columns', () => {
    expect(isIdField('Timestamp', traceColumnMeta)).toBe(false);
    expect(isIdField('Events.Name[0]', traceColumnMeta)).toBe(false);
  });

  it('does not match Map or Array(Map) columns even if name ends in Id', () => {
    const meta = [{ name: 'MyMapId', type: 'Map(String, String)' }];
    expect(isIdField('MyMapId', meta)).toBe(false);
  });

  it('does not match keys with sub-keys after array index', () => {
    expect(isIdField('Events.Attributes[0].spanId', traceColumnMeta)).toBe(
      false,
    );
  });

  it('returns false for unknown columns', () => {
    expect(isIdField('UnknownId', traceColumnMeta)).toBe(false);
  });

  it('returns false for empty columnMeta', () => {
    expect(isIdField('TraceId', [])).toBe(false);
  });
});

describe('isTimestampArrayField', () => {
  it('identifies Array(DateTime64) column elements by index', () => {
    expect(isTimestampArrayField('Events.Timestamp[0]', traceColumnMeta)).toBe(
      true,
    );
    expect(isTimestampArrayField('Events.Timestamp[23]', traceColumnMeta)).toBe(
      true,
    );
    expect(isTimestampArrayField('Links.Timestamp[0]', traceColumnMeta)).toBe(
      true,
    );
  });

  it('identifies plain Array(DateTime64) column reference', () => {
    expect(isTimestampArrayField('Events.Timestamp', traceColumnMeta)).toBe(
      true,
    );
    expect(isTimestampArrayField('Links.Timestamp', traceColumnMeta)).toBe(
      true,
    );
  });

  it('does not match non-DateTime64 array columns', () => {
    expect(isTimestampArrayField('Events.Name[0]', traceColumnMeta)).toBe(
      false,
    );
    expect(isTimestampArrayField('Links.TraceId[0]', traceColumnMeta)).toBe(
      false,
    );
  });

  it('does not match non-array DateTime64 columns', () => {
    expect(isTimestampArrayField('Timestamp', traceColumnMeta)).toBe(false);
  });

  it('returns false for unknown columns', () => {
    expect(isTimestampArrayField('Unknown.Timestamp[0]', traceColumnMeta)).toBe(
      false,
    );
  });

  it('handles Array(DateTime64) with timezone parameter', () => {
    const meta = [
      { name: 'MyTimestamps', type: "Array(DateTime64(9, 'UTC'))" },
    ];
    expect(isTimestampArrayField('MyTimestamps[0]', meta)).toBe(true);
  });
});

describe('isDenylisted', () => {
  it('denylists ID fields', () => {
    expect(isDenylisted('TraceId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('SpanId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('ParentSpanId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('Links.TraceId[0]', traceColumnMeta)).toBe(true);
  });

  it('denylists timestamp array fields', () => {
    expect(isDenylisted('Events.Timestamp[0]', traceColumnMeta)).toBe(true);
    expect(isDenylisted('Links.Timestamp[3]', traceColumnMeta)).toBe(true);
  });

  it('does not denylist useful fields', () => {
    expect(
      isDenylisted('ResourceAttributes.service.name', traceColumnMeta),
    ).toBe(false);
    expect(isDenylisted('SpanAttributes.http.method', traceColumnMeta)).toBe(
      false,
    );
    expect(isDenylisted('Events.Name[0]', traceColumnMeta)).toBe(false);
  });
});

describe('isHighCardinality', () => {
  it('identifies high cardinality fields (all unique values)', () => {
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      outlierValues.set(`value-${i}`, 0.1);
    }
    const outlierValueOccurences = new Map([['TraceId', outlierValues]]);
    const outlierPropertyOccurences = new Map([['TraceId', 1000]]);

    expect(
      isHighCardinality(
        'TraceId',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(true);
  });

  it('keeps low cardinality fields visible', () => {
    const outlierValues = new Map([
      ['GET', 80],
      ['POST', 20],
    ]);
    const outlierValueOccurences = new Map([['http.method', outlierValues]]);
    const outlierPropertyOccurences = new Map([['http.method', 1000]]);

    expect(
      isHighCardinality(
        'http.method',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(false);
  });

  it('uses min of both groups — keeps visible if either group has low cardinality', () => {
    const outlierValues = new Map([
      ['GET', 80],
      ['POST', 20],
    ]);
    const outlierValueOccurences = new Map([['method', outlierValues]]);
    const outlierPropertyOccurences = new Map([['method', 1000]]);

    const inlierValues = new Map<string, number>();
    for (let i = 0; i < 500; i++) inlierValues.set(`v${i}`, 0.2);
    const inlierValueOccurences = new Map([['method', inlierValues]]);
    const inlierPropertyOccurences = new Map([['method', 500]]);

    expect(
      isHighCardinality(
        'method',
        outlierValueOccurences,
        inlierValueOccurences,
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(false);
  });

  it('hides field when BOTH groups have high cardinality', () => {
    const makeHighCardinalityMap = (n: number) => {
      const m = new Map<string, number>();
      for (let i = 0; i < n; i++) m.set(`v${i}`, 100 / n);
      return m;
    };

    const outlierValues = makeHighCardinalityMap(500);
    const inlierValues = makeHighCardinalityMap(400);
    const outlierValueOccurences = new Map([['url', outlierValues]]);
    const inlierValueOccurences = new Map([['url', inlierValues]]);
    const outlierPropertyOccurences = new Map([['url', 500]]);
    const inlierPropertyOccurences = new Map([['url', 400]]);

    expect(
      isHighCardinality(
        'url',
        outlierValueOccurences,
        inlierValueOccurences,
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(true);
  });

  it('keeps visible when combined sample size is <= 20', () => {
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 10; i++) outlierValues.set(`v${i}`, 10);
    const outlierValueOccurences = new Map([['field', outlierValues]]);
    const outlierPropertyOccurences = new Map([['field', 10]]);
    const inlierPropertyOccurences = new Map([['field', 10]]);

    expect(
      isHighCardinality(
        'field',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(false);
  });

  it('uses single group uniqueness when other group has no data', () => {
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 100; i++) outlierValues.set(`v${i}`, 1);
    const outlierValueOccurences = new Map([['id', outlierValues]]);
    const outlierPropertyOccurences = new Map([['id', 100]]);

    expect(
      isHighCardinality(
        'id',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(true);
  });

  it('returns false for field not present in either group', () => {
    expect(
      isHighCardinality(
        'unknownField',
        new Map(),
        new Map(),
        new Map(),
        new Map(),
      ),
    ).toBe(false);
  });
});

describe('field split logic (visible vs hidden)', () => {
  it('correctly classifies a mix of ID, timestamp, cardinality, and useful fields', () => {
    expect(isDenylisted('TraceId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('Events.Timestamp[0]', traceColumnMeta)).toBe(true);
    expect(
      isDenylisted('ResourceAttributes.service.name', traceColumnMeta),
    ).toBe(false);

    // High cardinality field → hidden
    const hcValues = new Map<string, number>();
    for (let i = 0; i < 1000; i++) hcValues.set(`trace-${i}`, 0.1);
    expect(
      isHighCardinality(
        'trace.id',
        new Map([['trace.id', hcValues]]),
        new Map(),
        new Map([['trace.id', 1000]]),
        new Map(),
      ),
    ).toBe(true);

    // Low cardinality field → visible
    const lcValues = new Map([
      ['production', 70],
      ['staging', 30],
    ]);
    expect(
      isHighCardinality(
        'deployment.env',
        new Map([['deployment.env', lcValues]]),
        new Map(),
        new Map([['deployment.env', 1000]]),
        new Map(),
      ),
    ).toBe(false);
  });
});
