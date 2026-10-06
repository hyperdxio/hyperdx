import {
  clearRecentErrors,
  getRecentErrors,
  recordRecentError,
} from '@/recentErrors';

afterEach(() => {
  clearRecentErrors();
});

describe('recentErrors', () => {
  it('keeps only the newest 20 errors', () => {
    for (let i = 0; i < 25; i++) recordRecentError(new Error(`e${i}`));

    const errors = getRecentErrors();
    expect(errors).toHaveLength(20);
    expect(errors[0].message).toBe('e5');
    expect(errors[19].message).toBe('e24');
  });

  it('truncates long messages to 300 characters', () => {
    recordRecentError(new Error('x'.repeat(1000)));

    expect(getRecentErrors()[0].message).toHaveLength(300);
  });

  it('reads the HTTP status from a ky HTTPError', () => {
    const err = Object.assign(new Error('Request failed'), {
      name: 'HTTPError',
      response: { status: 502 },
    });
    recordRecentError(err);

    expect(getRecentErrors()[0]).toMatchObject({
      name: 'HTTPError',
      status: 502,
    });
  });

  it('parses the ClickHouse error code from the message', () => {
    const err = new Error(
      'Code: 60. DB::Exception: Table default.x does not exist',
    );
    err.name = 'ClickHouseQueryError';
    recordRecentError(err);

    expect(getRecentErrors()[0].code).toBe(60);
  });

  it('reads the ClickHouse error code from the client error cause', () => {
    const err = Object.assign(new Error('Table default.x does not exist'), {
      name: 'ClickHouseQueryError',
      cause: { code: '60' },
    });
    recordRecentError(err);

    expect(getRecentErrors()[0].code).toBe(60);
  });

  it('stringifies non-Error values', () => {
    recordRecentError('boom');

    expect(getRecentErrors()[0]).toMatchObject({
      name: 'Error',
      message: 'boom',
    });
  });

  it('records the route pathname without the query string', () => {
    window.history.pushState({}, '', '/search?token=secret');
    recordRecentError(new Error('e'));

    expect(getRecentErrors()[0].route).toBe('/search');
  });

  it('does not keep the query text a ClickHouseQueryError carries', () => {
    const err = Object.assign(new Error('Code: 62. Syntax error'), {
      name: 'ClickHouseQueryError',
      query: "SELECT * FROM logs WHERE email = 'a@b.com'",
    });
    recordRecentError(err);

    expect(JSON.stringify(getRecentErrors())).not.toContain('a@b.com');
  });

  it.each([
    "Code: 62. DB::Exception: Syntax error: failed at position 40 ('a@b.com'): 'a@b.com' LIMIT 10",
    "Code: 47. DB::Exception: Unknown identifier: foo. In scope SELECT * FROM logs WHERE email = 'a@b.com'",
    "Code: 47. DB::Exception: Unknown expression identifier `nope` in scope SELECT nope FROM logs WHERE email = 'a@b.com'. (UNKNOWN_IDENTIFIER)",
    "Code: 47. DB::Exception: Missing columns: 'foo' while processing query: 'SELECT foo FROM logs WHERE email = 'a@b.com''",
  ])('drops the query fragments ClickHouse quotes: %s', message => {
    recordRecentError(new Error(message));

    const recorded = getRecentErrors()[0].message;
    expect(recorded).toMatch(/^Code: \d+\. DB::Exception: /);
    expect(recorded).not.toContain('a@b.com');
    expect(recorded).not.toMatch(/SELECT/);
  });

  it('records which API endpoint failed, without the query string', () => {
    const err = Object.assign(
      new Error('Request failed with status code 500'),
      {
        name: 'HTTPError',
        request: {
          method: 'POST',
          url: 'http://localhost/api/sources?token=abc',
        },
        response: { status: 500 },
      },
    );
    recordRecentError(err);

    expect(getRecentErrors()[0]).toMatchObject({
      endpoint: 'POST /api/sources',
      status: 500,
    });
  });

  it('collapses repeats of the same failure into one entry with a count', () => {
    recordRecentError(new Error('first distinct failure'));
    for (let i = 0; i < 25; i++)
      recordRecentError(new Error('tile refresh failed'));

    const errors = getRecentErrors();
    expect(errors.map(e => e.message)).toEqual([
      'first distinct failure',
      'tile refresh failed',
    ]);
    expect(errors[1].count).toBe(25);
  });

  it('leaves quoted names in ordinary JS errors alone', () => {
    recordRecentError(
      new TypeError("Cannot read properties of undefined (reading 'sourceId')"),
    );

    expect(getRecentErrors()[0].message).toBe(
      "Cannot read properties of undefined (reading 'sourceId')",
    );
  });

  it('reads the reason from the API response without consuming it', async () => {
    // jsdom has no Response; this fake records whether the original body was read.
    const response = {
      status: 404,
      text: jest.fn(),
      clone: () => ({ json: async () => ({ message: 'Source not found' }) }),
    };
    const err = Object.assign(
      new Error('Request failed with status code 404'),
      {
        name: 'HTTPError',
        request: { method: 'GET', url: 'http://localhost/api/sources/1' },
        response,
      },
    );
    recordRecentError(err);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getRecentErrors()[0].reason).toBe('Source not found');
    expect(response.text).not.toHaveBeenCalled();
  });

  it('keeps each error on one line', () => {
    recordRecentError(new Error('first line\n  second line'));

    expect(getRecentErrors()[0].message).toBe('first line second line');
  });

  it('cuts the old analyzer ": While processing" suffix', () => {
    recordRecentError(
      new Error(
        'Code: 47. DB::Exception: Unknown identifier: foo: While processing foo = 42 AND email = a@b.com',
      ),
    );

    expect(getRecentErrors()[0].message).toBe(
      'Code: 47. DB::Exception: Unknown identifier: foo',
    );
  });

  it('cuts at "failed at position" even without quoted literals', () => {
    recordRecentError(
      new Error(
        'Code: 62. DB::Exception: Syntax error: failed at position 40 (end of query): SELECT x FROM logs WHERE id = 42',
      ),
    );

    expect(getRecentErrors()[0].message).toBe(
      'Code: 62. DB::Exception: Syntax error:',
    );
  });

  describe('API reasons', () => {
    const apiError = (body: () => Promise<unknown>) =>
      Object.assign(new Error('Request failed with status code 400'), {
        name: 'HTTPError',
        request: { method: 'POST', url: 'http://localhost/api/dashboards' },
        response: { status: 400, clone: () => ({ json: body }) },
      });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    it('reads every issue from a schema rejection', async () => {
      recordRecentError(
        apiError(async () => [
          { errors: { issues: [{ message: 'name is required' }] } },
          { errors: { issues: [{ message: 'tiles must be an array' }] } },
        ]),
      );
      await settle();

      expect(getRecentErrors()[0].reason).toBe(
        'name is required; tiles must be an array',
      );
    });

    it('keeps the status message when the body is not an API error', async () => {
      recordRecentError(
        apiError(async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        }),
      );
      await settle();

      expect(getRecentErrors()[0]).toMatchObject({
        message: 'Request failed with status code 400',
      });
      expect(getRecentErrors()[0].reason).toBeUndefined();
    });

    it('keeps different reasons on the same endpoint apart', async () => {
      recordRecentError(
        apiError(async () => ({ message: 'name is required' })),
      );
      recordRecentError(apiError(async () => ({ message: 'tiles invalid' })));
      await settle();

      expect(getRecentErrors().map(e => [e.reason, e.count])).toEqual([
        ['name is required', 1],
        ['tiles invalid', 1],
      ]);
    });

    it('collapses the same reason on the same endpoint', async () => {
      recordRecentError(
        apiError(async () => ({ message: 'name is required' })),
      );
      recordRecentError(
        apiError(async () => ({ message: 'name is required' })),
      );
      await settle();

      expect(getRecentErrors().map(e => [e.reason, e.count])).toEqual([
        ['name is required', 2],
      ]);
    });
  });

  it('keeps quoted identifiers but blanks compared values', () => {
    recordRecentError(
      new Error(
        "Code: 47. DB::Exception: Missing columns: 'ServiceName' while processing query: 'SELECT ServiceName'",
      ),
    );
    recordRecentError(
      new Error("Code: 60. DB::Exception: No rows for email = 'a@b.com'"),
    );

    const [missing, compared] = getRecentErrors().map(e => e.message);
    expect(missing).toBe(
      "Code: 47. DB::Exception: Missing columns: 'ServiceName'",
    );
    expect(compared).toBe("Code: 60. DB::Exception: No rows for email = '?'");
  });

  it('does not let failures awaiting a reason push out other errors', async () => {
    for (let i = 0; i < 5; i++)
      recordRecentError(new Error(`Code: 60. table t${i}`));
    for (let i = 0; i < 25; i++) {
      recordRecentError(
        Object.assign(new Error('Request failed with status code 500'), {
          name: 'HTTPError',
          request: { method: 'GET', url: 'http://localhost/api/sources' },
          response: {
            status: 500,
            clone: () => ({ json: async () => ({ message: 'boom' }) }),
          },
        }),
      );
    }

    await new Promise(resolve => setTimeout(resolve, 0));

    // The 5 overflowed past the pending cap settle without their reason; the
    // rest fold together once theirs arrives. No earlier error is evicted.
    const errors = getRecentErrors();
    expect(errors.filter(e => e.code === 60)).toHaveLength(5);
    expect(
      errors.filter(e => e.status === 500).reduce((n, e) => n + e.count, 0),
    ).toBe(25);
  });

  it.each([
    [
      'every value in an IN list',
      "Code: 60. DB::Exception: No data for id IN ('customer-a', 'customer-b')",
      "Code: 60. DB::Exception: No data for id IN ('?', '?')",
    ],
    [
      'escaped quotes inside a value',
      "Code: 60. DB::Exception: No rows for name = 'O''Brien'",
      "Code: 60. DB::Exception: No rows for name = '?'",
    ],
    [
      'a value ClickHouse failed to parse',
      "Code: 6. DB::Exception: Cannot parse string 'alice@example.com' as UInt64: syntax error at begin of string.",
      "Code: 6. DB::Exception: Cannot parse string '?' as UInt64: syntax error at begin of string.",
    ],
    [
      'any quoted text that is not an identifier',
      "Code: 36. DB::Exception: Unexpected value 'alice@example.com'",
      "Code: 36. DB::Exception: Unexpected value '?'",
    ],
  ])('blanks %s', (_case, message, expected) => {
    recordRecentError(new Error(message));

    expect(getRecentErrors()[0].message).toBe(expected);
  });

  it('caps pending entries and lists everything in time order', async () => {
    // Real performance: its timeOrigin is what timestamps are built from.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'performance'],
    });
    try {
      for (let i = 0; i < 25; i++) {
        recordRecentError(
          Object.assign(new Error(`Request failed ${i}`), {
            name: 'HTTPError',
            request: { method: 'GET', url: `http://localhost/api/s/${i}` },
            // A body whose json() never settles must not stay pending forever.
            response: {
              status: 500,
              clone: () => ({ json: () => new Promise(() => {}) }),
            },
          }),
        );
      }
      expect(getRecentErrors()).toHaveLength(20);

      await jest.advanceTimersByTimeAsync(10_000);
      const errors = getRecentErrors();
      expect(errors).toHaveLength(20);
      expect(errors.map(e => e.at)).toEqual([...errors.map(e => e.at)].sort());
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [
      'a bare word that is a customer value',
      "Code: 36. DB::Exception: Unexpected value 'alice'",
      "Code: 36. DB::Exception: Unexpected value '?'",
    ],
    [
      'a parsed value that looks like an identifier',
      "Code: 6. DB::Exception: Cannot parse string 'alice' as UInt64",
      "Code: 6. DB::Exception: Cannot parse string '?' as UInt64",
    ],
  ])('blanks %s', (_case, message, expected) => {
    recordRecentError(new Error(message));

    expect(getRecentErrors()[0].message).toBe(expected);
  });

  it.each([
    [
      'every name in a missing-columns list',
      "Code: 47. DB::Exception: Missing columns: 'ServiceName', 'SpanName'",
    ],
    [
      'a table expression identifier',
      "Code: 60. DB::Exception: Unknown table expression identifier 'otel_logs'",
    ],
    [
      'a function name',
      "Code: 46. DB::Exception: Function with name 'toStartOfFoo' does not exist",
    ],
  ])('keeps %s', (_case, message) => {
    recordRecentError(new Error(message));

    expect(getRecentErrors()[0].message).toBe(message);
  });
});
