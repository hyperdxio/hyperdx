import { ColumnMeta, JSDataType } from '@hyperdx/common-utils/dist/clickhouse';

import {
  getSourcesWithKey,
  getSqlSourceKeys,
} from '@/components/AdhocDashboardFilter/useAdhocFilterOptions';

const column = (name: string, type: string): ColumnMeta => ({
  name,
  type,
  codec_expression: '',
  comment: '',
  default_expression: '',
  default_type: '',
  ttl_expression: '',
});

describe('getSqlSourceKeys', () => {
  const columns = [
    column('ServiceName', 'LowCardinality(String)'),
    column('LogAttributes', 'Map(LowCardinality(String), String)'),
    column('Body', 'JSON'),
    column('Events', 'Array(String)'),
  ];

  it('offers scalar columns and the keys inside map and JSON columns', () => {
    expect(
      getSqlSourceKeys(
        [
          { path: ['ServiceName'], type: 'String', jsType: JSDataType.String },
          { path: ['LogAttributes', '1'], type: 'String', jsType: null },
          { path: ['Body', 'user.id'], type: 'String', jsType: null },
        ],
        columns,
      ),
    ).toEqual(['ServiceName', "LogAttributes['1']", 'Body.`user`.`id`']);
  });

  it('leaves out whole map, JSON, array, and tuple columns', () => {
    expect(
      getSqlSourceKeys(
        [
          { path: ['LogAttributes'], type: 'Map', jsType: JSDataType.Map },
          { path: ['Body'], type: 'JSON', jsType: JSDataType.JSON },
          { path: ['Events'], type: 'Array', jsType: JSDataType.Array },
          { path: ['Pair'], type: 'Tuple', jsType: JSDataType.Tuple },
        ],
        columns,
      ),
    ).toEqual([]);
  });
});

describe('getSourcesWithKey', () => {
  const sources = [{ id: 'logs' }, { id: 'traces' }];

  it('looks up a key only in the sources known to have it', () => {
    const keysBySourceId = new Map([
      ['logs', ['ServiceName', 'SeverityText']],
      ['traces', ['ServiceName', 'SpanName']],
    ]);

    expect(getSourcesWithKey(sources, keysBySourceId, 'SeverityText')).toEqual([
      { id: 'logs' },
    ]);
    expect(getSourcesWithKey(sources, keysBySourceId, 'ServiceName')).toEqual(
      sources,
    );
  });

  it('looks up a key no source is known to have in every source', () => {
    expect(
      getSourcesWithKey(sources, new Map([['logs', ['ServiceName']]]), 'typed'),
    ).toEqual(sources);
  });
});
