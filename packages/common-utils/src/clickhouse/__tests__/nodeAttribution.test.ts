import type { BaseResultSet, DataFormat } from '@clickhouse/client-common';

import { QueryInputs } from '@/clickhouse';
import {
  ClickhouseClient,
  getCurrentQueryAttribution,
  withQueryAttribution,
} from '@/clickhouse/node';

/** Records the inputs the base class produced instead of hitting the network. */
class RecordingNodeClient extends ClickhouseClient {
  public lastInputs?: QueryInputs<'JSON'>;

  protected async __query<Format extends DataFormat>(
    inputs: QueryInputs<Format>,
  ): Promise<BaseResultSet<ReadableStream, Format>> {
    this.lastInputs = inputs as unknown as QueryInputs<'JSON'>;
    return {} as unknown as BaseResultSet<ReadableStream, Format>;
  }
}

const newClient = () =>
  new RecordingNodeClient({ host: 'http://localhost:8123' });

const logCommentOf = (client: RecordingNodeClient) =>
  JSON.parse(String(client.lastInputs?.clickhouse_settings?.log_comment));

describe('withQueryAttribution', () => {
  it('exposes nothing outside a scope', () => {
    expect(getCurrentQueryAttribution()).toBeUndefined();
  });

  it('nests, with the inner scope winning on conflict', () => {
    withQueryAttribution({ surface: 'alert', label: 'outer' }, () => {
      withQueryAttribution({ alert: 'alert-1', label: 'inner' }, () => {
        expect(getCurrentQueryAttribution()).toEqual({
          surface: 'alert',
          label: 'inner',
          alert: 'alert-1',
        });
      });
      expect(getCurrentQueryAttribution()).toEqual({
        surface: 'alert',
        label: 'outer',
      });
    });
  });

  it('survives await boundaries', async () => {
    await withQueryAttribution({ surface: 'mcp', label: 'tool' }, async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(getCurrentQueryAttribution()?.label).toBe('tool');
    });
  });

  it('keeps concurrent scopes isolated', async () => {
    const seen = await Promise.all([
      withQueryAttribution({ surface: 'alert', alert: 'a' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return getCurrentQueryAttribution()?.alert;
      }),
      withQueryAttribution({ surface: 'alert', alert: 'b' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return getCurrentQueryAttribution()?.alert;
      }),
    ]);

    expect(seen).toEqual(['a', 'b']);
  });
});

describe('node client attribution precedence', () => {
  it('stamps a query issued inside a scope', async () => {
    const client = newClient();
    await withQueryAttribution(
      { surface: 'alert', alert: 'alert-1' },
      async () => {
        await client.query({ query: 'SELECT 1' });
      },
    );

    expect(logCommentOf(client)).toMatchObject({
      surface: 'alert',
      alert: 'alert-1',
    });
    expect(client.lastInputs?.queryId).toMatch(/^hdx-alert-/);
  });

  it('lets the request scope override the client default', async () => {
    const client = new RecordingNodeClient({
      host: 'http://localhost:8123',
      attribution: { surface: 'api', label: 'default' },
    });

    await withQueryAttribution({ label: 'scoped' }, async () => {
      await client.query({ query: 'SELECT 1' });
    });

    expect(logCommentOf(client)).toMatchObject({
      surface: 'api',
      label: 'scoped',
    });
  });

  it('lets a per-query value override the ambient scope', async () => {
    const client = newClient();
    await withQueryAttribution({ surface: 'mcp', label: 'outer' }, async () => {
      await client.query({
        query: 'SELECT 1',
        attribution: { label: 'inner' },
      });
    });

    expect(logCommentOf(client)).toMatchObject({
      surface: 'mcp',
      label: 'inner',
    });
  });

  it('falls back to the client default outside any scope', async () => {
    const client = new RecordingNodeClient({
      host: 'http://localhost:8123',
      attribution: { surface: 'api' },
    });
    await client.query({ query: 'SELECT 1' });

    expect(logCommentOf(client)).toMatchObject({ surface: 'api' });
  });
});
