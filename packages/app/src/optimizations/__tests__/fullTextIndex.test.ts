import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import {
  __testing,
  buildFullTextIndexDDL,
  fullTextIndexPlugin,
} from '../plugins/fullTextIndex';

const { detect } = __testing;

function makeLogSource(overrides: Partial<TSource> = {}): TSource {
  return {
    id: 'src-log',
    name: 'logs',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'db', tableName: 'logs' },
    timestampValueExpression: 'TimestampTime',
    defaultTableSelectExpression: 'Body',
    implicitColumnExpression: 'Body',
    ...overrides,
  } as TSource;
}

function makeMetadata({
  skipIndices,
}: {
  skipIndices?: Record<
    string,
    Array<{ type: string; typeFull: string; expression: string }>
  >;
}): Metadata {
  return {
    getSkipIndices: jest.fn(
      async ({
        databaseName,
        tableName,
      }: {
        databaseName: string;
        tableName: string;
      }) =>
        (skipIndices?.[`${databaseName}.${tableName}`] ?? []).map(idx => ({
          name: 'idx',
          granularity: 1,
          ...idx,
        })),
    ),
  } as unknown as Metadata;
}

describe('fullTextIndexPlugin', () => {
  it('emits a finding when a log source has no full-text index', async () => {
    const source = makeLogSource();
    const findings = await detect({
      sources: [source],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        skipIndices: { 'db.logs': [] },
      }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      scopeId: 'source:src-log',
      detail: { sourceId: 'src-log' },
    });
  });

  it('does not emit when an existing text index covers the implicit column', async () => {
    const source = makeLogSource();
    const findings = await detect({
      sources: [source],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        skipIndices: {
          'db.logs': [
            {
              type: 'text',
              typeFull: "text(tokenizer='splitByNonAlpha')",
              expression: 'Body',
            },
          ],
        },
      }),
    });

    expect(findings).toHaveLength(0);
  });

  it('still emits when only non-text index types are present', async () => {
    const source = makeLogSource();
    const findings = await detect({
      sources: [source],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({
        skipIndices: {
          'db.logs': [
            { type: 'minmax', typeFull: 'minmax', expression: 'Body' },
          ],
        },
      }),
    });

    expect(findings).toHaveLength(1);
  });

  it('skips sources without an implicitColumnExpression', async () => {
    const source = makeLogSource({
      implicitColumnExpression: '',
    } as Partial<TSource>);
    const findings = await detect({
      sources: [source],
      clickhouseClient: {} as ClickhouseClient,
      metadata: makeMetadata({}),
    });

    expect(findings).toHaveLength(0);
  });

  it('buildDDL produces a syntactically reasonable ALTER TABLE', () => {
    const statements = buildFullTextIndexDDL({
      sourceId: 'x',
      databaseName: 'db',
      tableName: 'logs',
      implicitColumnExpression: 'Body',
    });

    expect(statements).toHaveLength(1);
    const [ddl] = statements;
    expect(ddl).toContain('ALTER TABLE `db`.`logs`');
    expect(ddl).toContain('ADD INDEX hdx_implicit_full_text_idx (Body)');
    expect(ddl).toContain('TYPE full_text(0)');
    expect(ddl).toContain('GRANULARITY 1');
    // No bundled MATERIALIZE INDEX backfill — the user runs that separately.
    expect(ddl).not.toMatch(/MATERIALIZE INDEX/);
  });

  it('plugin.resolveSource returns the matching source by sourceId', () => {
    const source = makeLogSource();
    const finding = {
      scopeId: 'source:src-log',
      summary: '',
      detail: {
        sourceId: 'src-log',
        databaseName: 'db',
        tableName: 'logs',
        implicitColumnExpression: 'Body',
      },
    };
    expect(fullTextIndexPlugin.resolveSource?.(finding, [source])).toBe(source);
  });
});
