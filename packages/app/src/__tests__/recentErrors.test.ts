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
});
