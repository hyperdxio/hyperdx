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
