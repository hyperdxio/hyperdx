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

/** The search params of the single request the call issued. */
const requestedParams = () =>
  new URLSearchParams(get.mock.calls[0][1].searchParams);

/** As `requestedParams`, for the calls this module issues over POST. */
const postedParams = () =>
  new URLSearchParams(post.mock.calls[0][1].searchParams);

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
      connectionId: 'conn',
      database: 'db',
      table: 'tbl',
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
  });

  it('omits the selector when there is none', async () => {
    await prometheusApi.labelValues({ label: 'pod', connectionId: 'conn' });

    expect(requestedParams().has('match[]')).toBe(false);
  });

  it('reports a repeated value once', async () => {
    get.mockReturnValue({
      json: () =>
        Promise.resolve({ status: 'success', data: ['byoc', 'api', 'byoc'] }),
    });

    const resp = await prometheusApi.labelValues({
      label: 'pod',
      connectionId: 'conn',
    });

    // Mantine throws on duplicate options, taking the page down with it.
    expect(resp.data).toEqual(['byoc', 'api']);
  });
});

describe('prometheusApi.labels', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('reports a repeated label name once', async () => {
    get.mockReturnValue({
      json: () =>
        Promise.resolve({
          status: 'success',
          data: ['byoc', 'instance', 'byoc'],
        }),
    });

    const resp = await prometheusApi.labels({ connectionId: 'conn' });

    expect(resp.data).toEqual(['byoc', 'instance']);
  });

  it('leaves a response without data alone', async () => {
    get.mockReturnValue({
      json: () => Promise.resolve({ status: 'error', error: 'nope' }),
    });

    const resp = await prometheusApi.labels({ connectionId: 'conn' });

    expect(resp).toEqual({ status: 'error', error: 'nope' });
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
      connectionId: 'conn',
      database: 'db',
      table: 'tbl',
    });

    expect(post).toHaveBeenCalledWith('v1/prometheus/query', expect.anything());
    const params = postedParams();
    expect(params.get('query')).toBe('sum(up)');
    expect(params.get('time')).toBe('1700000000');
    expect(params.get('connectionId')).toBe('conn');
    expect(params.get('database')).toBe('db');
    expect(params.get('table')).toBe('tbl');
    // The instant endpoint takes no range, and sending one would be forwarded
    // upstream as an unrecognized param.
    expect(params.has('start')).toBe(false);
    expect(params.has('end')).toBe(false);
    expect(params.has('step')).toBe(false);
  });

  it('omits the table params a Prometheus-backed connection has no use for', async () => {
    await prometheusApi.query({
      query: 'up',
      time: 1,
      connectionId: 'conn',
    });

    const params = postedParams();
    expect(params.has('database')).toBe(false);
    expect(params.has('table')).toBe(false);
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
      connectionId: 'conn',
    });

    expect(resp).toEqual({
      status: 'error',
      errorType: 'bad_data',
      error: 'parse error',
    });
  });
});
