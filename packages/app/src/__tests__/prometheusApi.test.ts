const get = jest.fn();
const post = jest.fn();

// The suite-wide ky mock answers every verb with an empty object, which is
// enough for callers that ignore the response but not for reading back the
// request this module builds.
jest.mock('ky-universal', () => {
  const ky = jest.fn();
  Object.assign(ky, { create: () => ({ get, post }), extend: () => ky });
  return ky;
});

import { prometheusApi } from '@/api';

const SOURCE_ID = 'source-promql';

/** The search params of the single request the call issued. */
const requestedParams = () =>
  new URLSearchParams(get.mock.calls[0][1].searchParams);

/** As `requestedParams`, for the calls this module issues over POST. */
const postedParams = () =>
  new URLSearchParams(post.mock.calls[0][1].searchParams);

/**
 * The server resolves the connection and table from the source, so naming any
 * of them would only invite it to be trusted over the source.
 */
const expectOnlySourceNamed = (params: URLSearchParams) => {
  expect(params.get('sourceId')).toBe(SOURCE_ID);
  expect(params.has('connectionId')).toBe(false);
  expect(params.has('database')).toBe(false);
  expect(params.has('table')).toBe(false);
};

describe('prometheusApi.labelValues', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockReturnValue({
      json: () => Promise.resolve({ status: 'success', data: ['api'] }),
    });
  });

  it('sends the selector under the repeatable name Prometheus expects', async () => {
    await prometheusApi.labelValues({
      label: 'pod',
      sourceId: SOURCE_ID,
      start: 100,
      end: 200,
      match: 'up{job="api"}',
    });

    expect(get).toHaveBeenCalledWith(
      'v1/prometheus/label/pod/values',
      expect.anything(),
    );
    const params = requestedParams();
    expect(params.getAll('match[]')).toEqual(['up{job="api"}']);
    expect(params.get('start')).toBe('100');
    expect(params.get('end')).toBe('200');
    expectOnlySourceNamed(params);
  });

  it('sends the attribution as a header', async () => {
    await prometheusApi.labelValues({
      label: 'pod',
      sourceId: SOURCE_ID,
      attribution: { surface: 'metadata', dashboard: 'd1' },
    });

    const { headers } = get.mock.calls[0][1];
    expect(JSON.parse(headers['x-hyperdx-query-attribution'])).toEqual({
      v: 1,
      surface: 'metadata',
      dashboard: 'd1',
    });
  });

  it('omits the selector when there is none', async () => {
    await prometheusApi.labelValues({ label: 'pod', sourceId: SOURCE_ID });

    expect(requestedParams().has('match[]')).toBe(false);
  });

  it('reports a repeated value once', async () => {
    get.mockReturnValue({
      json: () =>
        Promise.resolve({ status: 'success', data: ['byoc', 'api', 'byoc'] }),
    });

    const resp = await prometheusApi.labelValues({
      label: 'pod',
      sourceId: SOURCE_ID,
    });

    // Mantine throws on duplicate options, taking the page down with it.
    expect(resp.data).toEqual(['byoc', 'api']);
  });
});

describe('prometheusApi.labels', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('names the source the label names are read from', async () => {
    get.mockReturnValue({
      json: () => Promise.resolve({ status: 'success', data: ['instance'] }),
    });

    await prometheusApi.labels({ sourceId: SOURCE_ID, start: 100, end: 200 });

    expect(get).toHaveBeenCalledWith('v1/prometheus/labels', expect.anything());
    const params = requestedParams();
    expect(params.get('start')).toBe('100');
    expect(params.get('end')).toBe('200');
    expectOnlySourceNamed(params);
  });

  it('reports a repeated label name once', async () => {
    get.mockReturnValue({
      json: () =>
        Promise.resolve({
          status: 'success',
          data: ['byoc', 'instance', 'byoc'],
        }),
    });

    const resp = await prometheusApi.labels({ sourceId: SOURCE_ID });

    expect(resp.data).toEqual(['byoc', 'instance']);
  });

  it('sends the attribution as a header', async () => {
    get.mockReturnValue({
      json: () => Promise.resolve({ status: 'success', data: [] }),
    });

    await prometheusApi.labels({
      sourceId: SOURCE_ID,
      attribution: { surface: 'metadata' },
    });

    const { headers } = get.mock.calls[0][1];
    expect(JSON.parse(headers['x-hyperdx-query-attribution'])).toEqual({
      v: 1,
      surface: 'metadata',
    });
  });

  it('leaves a response without data alone', async () => {
    get.mockReturnValue({
      json: () => Promise.resolve({ status: 'error', error: 'nope' }),
    });

    const resp = await prometheusApi.labels({ sourceId: SOURCE_ID });

    expect(resp).toEqual({ status: 'error', error: 'nope' });
  });
});

describe('prometheusApi.queryRange', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockReturnValue({
      json: () =>
        Promise.resolve({
          status: 'success',
          data: { resultType: 'matrix', result: [] },
        }),
    });
  });

  it('names only the source on a range query', async () => {
    await prometheusApi.queryRange({
      query: 'sum(up)',
      start: 100,
      end: 200,
      step: '15s',
      sourceId: SOURCE_ID,
    });

    expect(post).toHaveBeenCalledWith(
      'v1/prometheus/query_range',
      expect.anything(),
    );
    const params = postedParams();
    expect(params.get('query')).toBe('sum(up)');
    expect(params.get('start')).toBe('100');
    expect(params.get('end')).toBe('200');
    expect(params.get('step')).toBe('15s');
    expectOnlySourceNamed(params);
  });
});

describe('prometheusApi.query', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockReturnValue({
      json: () =>
        Promise.resolve({
          status: 'success',
          data: { resultType: 'vector', result: [] },
        }),
    });
  });

  it('asks the instant endpoint for a single evaluation time', async () => {
    await prometheusApi.query({
      query: 'sum(up)',
      time: 1700000000,
      sourceId: SOURCE_ID,
    });

    expect(post).toHaveBeenCalledWith('v1/prometheus/query', expect.anything());
    const params = postedParams();
    expect(params.get('query')).toBe('sum(up)');
    expect(params.get('time')).toBe('1700000000');
    expectOnlySourceNamed(params);
    // The instant endpoint takes no range, and sending one would be forwarded
    // upstream as an unrecognized param.
    expect(params.has('start')).toBe(false);
    expect(params.has('end')).toBe(false);
    expect(params.has('step')).toBe(false);
  });

  it('forwards a series limit only when one is given', async () => {
    await prometheusApi.query({
      query: 'up',
      time: 1,
      sourceId: SOURCE_ID,
      limit: 25,
    });
    expect(postedParams().get('limit')).toBe('25');

    post.mockClear();
    await prometheusApi.query({ query: 'up', time: 1, sourceId: SOURCE_ID });
    expect(postedParams().has('limit')).toBe(false);
  });

  it('sends the attribution as a log_comment payload in a header', async () => {
    await prometheusApi.query({
      query: 'up',
      time: 1,
      sourceId: SOURCE_ID,
      attribution: { surface: 'dashboard', dashboard: 'd1', tile: 't1' },
    });

    const { headers } = post.mock.calls[0][1];
    expect(JSON.parse(headers['x-hyperdx-query-attribution'])).toEqual({
      v: 1,
      surface: 'dashboard',
      dashboard: 'd1',
      tile: 't1',
    });
  });

  it('sends no attribution header when there is nothing to say', async () => {
    await prometheusApi.query({
      query: 'up',
      time: 1,
      sourceId: SOURCE_ID,
      attribution: {},
    });
    expect(post.mock.calls[0][1].headers).toBeUndefined();
  });

  it('reports the error a failed instant query carries', async () => {
    post.mockReturnValue({
      json: () =>
        Promise.resolve({
          status: 'error',
          errorType: 'bad_data',
          error: 'parse error',
        }),
    });

    const resp = await prometheusApi.query({
      query: 'sum(',
      time: 1,
      sourceId: SOURCE_ID,
    });

    expect(resp).toEqual({
      status: 'error',
      errorType: 'bad_data',
      error: 'parse error',
    });
  });
});
