import type { BaseResultSet, DataFormat } from '@clickhouse/client-common';

import { BaseClickhouseClient, QueryInputs } from '@/clickhouse';
import {
  buildLogComment,
  buildQueryId,
  mergeQueryAttribution,
  QUERY_ATTRIBUTION_VERSION,
  QueryAttribution,
  QuerySurface,
} from '@/clickhouse/attribution';

describe('mergeQueryAttribution', () => {
  it('lets later layers win', () => {
    expect(
      mergeQueryAttribution(
        { surface: 'dashboard', dashboard: 'dash-1' },
        { tile: 'tile-1' },
      ),
    ).toEqual({ surface: 'dashboard', dashboard: 'dash-1', tile: 'tile-1' });
  });

  it('does not let a later layer blank out an earlier value', () => {
    expect(
      mergeQueryAttribution(
        { surface: 'dashboard', dashboard: 'dash-1' },
        { dashboard: undefined, tile: '' },
      ),
    ).toEqual({ surface: 'dashboard', dashboard: 'dash-1' });
  });

  it('ignores undefined layers', () => {
    expect(
      mergeQueryAttribution(undefined, { search: 's-1' }, undefined),
    ).toEqual({ search: 's-1' });
  });
});

describe('buildLogComment', () => {
  it('returns undefined when there is nothing to stamp', () => {
    expect(buildLogComment(undefined)).toBeUndefined();
    expect(buildLogComment({})).toBeUndefined();
  });

  it('returns undefined when only unknown fields are present', () => {
    // A surface alone is worth stamping; an empty id is not.
    expect(buildLogComment({ dashboard: '   ' })).toBeUndefined();
  });

  it('emits versioned JSON with the populated fields only', () => {
    const comment = buildLogComment({
      surface: 'dashboard',
      dashboard: 'dash-1',
      tile: 'tile-1',
    });

    expect(JSON.parse(comment!)).toEqual({
      v: QUERY_ATTRIBUTION_VERSION,
      surface: 'dashboard',
      dashboard: 'dash-1',
      tile: 'tile-1',
    });
  });

  it('drops a surface that is not in the closed set', () => {
    const comment = buildLogComment({
      surface: 'definitely-not-a-surface' as unknown as QuerySurface,
      search: 'search-1',
    });

    expect(JSON.parse(comment!)).toEqual({
      v: QUERY_ATTRIBUTION_VERSION,
      search: 'search-1',
    });
  });

  /**
   * From the browser this rides in the URL query string. The proxy decodes it
   * before re-parsing, so an `&` surviving here would truncate the value and
   * inject a bogus parameter, failing every query on the page.
   */
  it('drops characters that would break the URL it travels in', () => {
    const comment = buildLogComment({
      surface: 'search',
      search: 'a&b?c=d#e%f+g',
    });

    expect(JSON.parse(comment!).search).toBe('abcdefg');
  });

  it('keeps the characters real ids and routes are made of', () => {
    const comment = buildLogComment({
      surface: 'api',
      source: '68b2f4c1a9e3d7b5c2a10f51',
      tile: '0f7c9a2e-4d1b-4a6f-9c3e-2b8d5f1a7c40',
      label: '/api/v2/charts',
    });

    const parsed = JSON.parse(comment!);
    expect(parsed.source).toBe('68b2f4c1a9e3d7b5c2a10f51');
    expect(parsed.tile).toBe('0f7c9a2e-4d1b-4a6f-9c3e-2b8d5f1a7c40');
    expect(parsed.label).toBe('/api/v2/charts');
  });

  it('drops non-ASCII rather than risk splitting it at the length cap', () => {
    const comment = buildLogComment({
      surface: 'search',
      label: `x${String.fromCodePoint(0x1f600)}y`,
    });

    expect(JSON.parse(comment!).label).toBe('xy');
  });

  it('strips control characters so the payload stays parseable', () => {
    const comment = buildLogComment({
      surface: 'search',
      label: `a${String.fromCharCode(0)}b\nc`,
    });

    expect(JSON.parse(comment!).label).toBe('abc');
  });

  it('caps an individual field', () => {
    const comment = buildLogComment({
      surface: 'search',
      label: 'x'.repeat(500),
    });

    expect(JSON.parse(comment!).label.length).toBe(128);
  });

  /**
   * Every field at its longest, with the longest surface name. Exact rather
   * than approximate because the allowlist is ASCII, so the per-field cap
   * counts bytes too. Fails if a field is added or a cap raised without
   * checking the budget the browser spends on every request's query string.
   */
  it('cannot exceed the size cap even when every field is at its longest', () => {
    const tooLong = 'x'.repeat(500);
    const comment = buildLogComment({
      surface: 'service-dashboard',
      dashboard: tooLong,
      tile: tooLong,
      search: tooLong,
      alert: tooLong,
      source: tooLong,
      trace: tooLong,
      label: tooLong,
    });

    expect(Buffer.byteLength(comment!)).toBeLessThanOrEqual(1024);
    // Nothing is shed today, so the worst case keeps every field.
    expect(Object.keys(JSON.parse(comment!))).toEqual([
      'v',
      'surface',
      'dashboard',
      'tile',
      'search',
      'alert',
      'source',
      'trace',
      'label',
    ]);
  });

  it('stays within budget for a realistic payload', () => {
    const comment = buildLogComment({
      surface: 'dashboard',
      dashboard: '68b2f4c1a9e3d7b5c2a10f4e',
      tile: '0f7c9a2e-4d1b-4a6f-9c3e-2b8d5f1a7c40',
      source: '68b2f4c1a9e3d7b5c2a10f51',
      trace: 'c3f1a9b7d2e4568a0b1c2d3e4f506172',
    });

    expect(Buffer.byteLength(comment!)).toBeLessThan(250);
  });

  it('produces valid JSON for values that need escaping', () => {
    const comment = buildLogComment({
      surface: 'search',
      label: 'quote " brace } backslash \\ ok',
    });

    // The quote, brace and backslash are not on the allowlist, so they never
    // reach JSON.stringify in the first place.
    expect(() => JSON.parse(comment!)).not.toThrow();
    expect(JSON.parse(comment!).label).toBe('quote  brace  backslash  ok');
  });
});

describe('buildQueryId', () => {
  it('prefixes with the surface', () => {
    expect(buildQueryId({ surface: 'alert' })).toMatch(/^hdx-alert-/);
  });

  it('falls back to unknown without a surface', () => {
    expect(buildQueryId(undefined)).toMatch(/^hdx-unknown-/);

    expect(
      buildQueryId({ surface: 'nope' as unknown as QuerySurface }),
    ).toMatch(/^hdx-unknown-/);
  });

  it('is unique per call', () => {
    const attribution: QueryAttribution = { surface: 'dashboard' };
    const ids = new Set(
      Array.from({ length: 200 }, () => buildQueryId(attribution)),
    );
    expect(ids.size).toBe(200);
  });
});

/**
 * Captures what the base class hands to the transport, so these assertions
 * cover the stamping every concrete client (browser, node, CLI) inherits.
 */
class RecordingClient extends BaseClickhouseClient {
  public lastInputs?: QueryInputs<'JSON'>;

  protected async __query<Format extends DataFormat>(
    inputs: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>> {
    this.lastInputs = inputs as unknown as QueryInputs<'JSON'>;
    // Nothing here reads the result; only the inputs are under test.
    return {} as unknown as BaseResultSet<ReadableStream, Format>;
  }
}

describe('BaseClickhouseClient attribution', () => {
  const newClient = (attribution?: QueryAttribution) =>
    new RecordingClient({ host: 'http://localhost:8123', attribution });

  it('stamps log_comment and a prefixed query_id', async () => {
    const client = newClient({ surface: 'dashboard', dashboard: 'dash-1' });
    await client.query({ query: 'SELECT 1' });

    const settings = client.lastInputs?.clickhouse_settings;
    expect(JSON.parse(String(settings?.log_comment))).toMatchObject({
      surface: 'dashboard',
      dashboard: 'dash-1',
    });
    expect(client.lastInputs?.queryId).toMatch(/^hdx-dashboard-/);
  });

  it('merges per-query attribution over the client default', async () => {
    const client = newClient({ surface: 'dashboard', dashboard: 'dash-1' });
    await client.query({
      query: 'SELECT 1',
      attribution: { tile: 'tile-9' },
    });

    expect(
      JSON.parse(String(client.lastInputs?.clickhouse_settings?.log_comment)),
    ).toMatchObject({
      surface: 'dashboard',
      dashboard: 'dash-1',
      tile: 'tile-9',
    });
  });

  it('preserves settings the caller already passed', async () => {
    const client = newClient({ surface: 'search' });
    await client.query({
      query: 'SELECT 1',
      clickhouse_settings: { max_execution_time: 7 },
    });

    const settings = client.lastInputs?.clickhouse_settings;
    expect(settings?.max_execution_time).toBe(7);
    expect(settings?.log_comment).toBeDefined();
  });

  it('never overrides a log_comment or query_id the caller set', async () => {
    const client = newClient({ surface: 'search' });
    await client.query({
      query: 'SELECT 1',
      clickhouse_settings: { log_comment: 'mine' },
      queryId: 'my-id',
    });

    expect(client.lastInputs?.clickhouse_settings?.log_comment).toBe('mine');
    expect(client.lastInputs?.queryId).toBe('my-id');
  });

  it('omits log_comment entirely when nothing is known', async () => {
    const client = newClient();
    await client.query({ query: 'SELECT 1' });

    expect(client.lastInputs?.clickhouse_settings?.log_comment).toBeUndefined();
    expect(client.lastInputs?.queryId).toMatch(/^hdx-unknown-/);
  });
});
