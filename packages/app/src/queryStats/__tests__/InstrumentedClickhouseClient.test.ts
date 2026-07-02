import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';

import {
  __resetInstrumentationWarnForTests,
  InstrumentedClickhouseClient,
} from '../InstrumentedClickhouseClient';
import { __resetQueryStatsForTests, getSnapshot } from '../queryStatsStore';
import * as storeModule from '../queryStatsStore';

// The base class's query() lives on the prototype chain above ClickhouseClient.
// Walk up so the spy intercepts what `super.query()` actually resolves to.
const baseQueryProto = Object.getPrototypeOf(ClickhouseClient.prototype);

// Suppress the deduped console.warn from the wrapper during tests.
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});
afterAll(() => {
  console.warn = originalWarn;
});

describe('InstrumentedClickhouseClient', () => {
  let superQuerySpy: jest.SpyInstance;

  beforeEach(() => {
    __resetQueryStatsForTests();
    __resetInstrumentationWarnForTests();
    superQuerySpy = jest
      .spyOn(baseQueryProto as any, 'query')
      .mockResolvedValue('result' as any);
  });

  afterEach(() => {
    superQuerySpy.mockRestore();
  });

  function makeClient() {
    return new InstrumentedClickhouseClient({ host: 'http://localhost' });
  }

  it('passes through the resolved value from super.query', async () => {
    const client = makeClient();
    const result = await client.query({ query: 'SELECT 1' });
    expect(result).toBe('result');
    expect(superQuerySpy).toHaveBeenCalledTimes(1);
  });

  it('auto-injects a queryId when none is provided', async () => {
    const client = makeClient();
    await client.query({ query: 'SELECT 1' });
    const call = superQuerySpy.mock.calls[0]?.[0];
    expect(typeof call.queryId).toBe('string');
    expect(call.queryId.length).toBeGreaterThan(0);
    expect(call.query).toBe('SELECT 1');
  });

  it('respects a caller-provided queryId', async () => {
    const client = makeClient();
    await client.query({ query: 'SELECT 1', queryId: 'caller-id' });
    const call = superQuerySpy.mock.calls[0]?.[0];
    expect(call.queryId).toBe('caller-id');
  });

  it('stores an internal event id distinct from queryId', async () => {
    const client = makeClient();
    await client.query({ query: 'SELECT 1', queryId: 'caller-id' });
    const [event] = getSnapshot();
    expect(event.queryId).toBe('caller-id');
    expect(event.id).not.toBe('caller-id');
    expect(event.id.length).toBeGreaterThan(0);
  });

  it('does not conflate events that share a caller-supplied queryId', async () => {
    const client = makeClient();
    await client.query({ query: 'SELECT 1', queryId: 'dup' });
    await client.query({ query: 'SELECT 2', queryId: 'dup' });
    const events = getSnapshot();
    expect(events).toHaveLength(2);
    expect(events[0].id).not.toBe(events[1].id);
    expect(events[0].status).toBe('done');
    expect(events[1].status).toBe('done');
  });

  it('shallow-clones params so caller mutation does not rewrite the stored event', async () => {
    const client = makeClient();
    const params: Record<string, any> = { a: 1 };
    await client.query({ query: 'SELECT {a:Int32}', query_params: params });
    params.a = 999;
    const [event] = getSnapshot();
    expect(event.params).toEqual({ a: 1 });
  });

  it('records a done event after a successful query', async () => {
    const client = makeClient();
    await client.query({ query: 'SELECT 1' });
    const events = getSnapshot();
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('done');
    expect(events[0].sql).toBe('SELECT 1');
    expect(typeof events[0].durationMs).toBe('number');
  });

  it('marks the event as error when super.query throws', async () => {
    superQuerySpy.mockRejectedValueOnce(new Error('boom'));
    const client = makeClient();
    await expect(client.query({ query: 'SELECT 1' })).rejects.toThrow('boom');
    const events = getSnapshot();
    expect(events[0].status).toBe('error');
    expect(events[0].error).toBe('boom');
  });

  it('marks the event as cancelled when the abort signal fired', async () => {
    const controller = new AbortController();
    controller.abort();
    superQuerySpy.mockRejectedValueOnce(new Error('aborted'));
    const client = makeClient();
    await expect(
      client.query({ query: 'SELECT 1', abort_signal: controller.signal }),
    ).rejects.toThrow('aborted');
    const events = getSnapshot();
    expect(events[0].status).toBe('cancelled');
  });

  it('detects EXPLAIN queries and tags the event kind', async () => {
    const client = makeClient();
    await client.query({ query: '  EXPLAIN PLAN SELECT 1' });
    expect(getSnapshot()[0].kind).toBe('explain');
  });

  it('still resolves the query when the store throws on append', async () => {
    const spy = jest
      .spyOn(storeModule, 'appendQueryEvent')
      .mockImplementation(() => {
        throw new Error('store down');
      });
    const client = makeClient();
    const result = await client.query({ query: 'SELECT 1' });
    expect(result).toBe('result');
    expect(superQuerySpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
