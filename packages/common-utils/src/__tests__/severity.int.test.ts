import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  buildSeverityClassExpressionV1,
  getSeverityClass,
  SEVERITY_CLASS_FACET_VALUES,
  TEXT_PREFIX_RULES,
} from '@/core/severity';
import { filtersToQuery } from '@/filters';
import { DisplayType } from '@/types';

type Row = { n: unknown; t: string | null; c: string; type: string };

const sqlLiteral = (value: string | number | null) =>
  value == null
    ? 'NULL'
    : typeof value === 'string'
      ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : String(value);

const NUMBERS = [null, -1, ...Array.from({ length: 26 }, (_, i) => i), 255];
const TEXTS = [
  null,
  '',
  'Warning',
  'critical',
  'NOTICE',
  'Information',
  'information',
  'INF',
  'dpanic',
  ' error',
  '[error]',
  'log_error',
  'dbug',
  'ok',
  'audit',
  'ÉRROR',
  'İnfo',
  'verbo\u017fe',
  ...TEXT_PREFIX_RULES.flatMap(r => [
    r.prefix,
    r.prefix.toUpperCase(),
    `${r.prefix[0].toUpperCase()}${r.prefix.slice(1)}`,
  ]),
];

describe('buildSeverityClassExpressionV1 (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;

  const DB = 'default';
  const TABLE = 'test_severity_class_logs';

  async function classify({
    structure,
    rows,
    numberExpr,
    textExpr,
  }: {
    structure: string;
    rows: string[];
    numberExpr: string;
    textExpr?: string;
  }): Promise<Row[]> {
    const key = buildSeverityClassExpressionV1({ numberExpr, textExpr });
    const result = await client.query({
      query: `
        SELECT ${numberExpr} AS n, ${textExpr ?? 'NULL'} AS t, ${key} AS c,
          toTypeName(c) AS type
        FROM values(${sqlLiteral(structure)}, ${rows.join(', ')})
      `,
      format: 'JSONEachRow',
    });
    return result.json<Row>();
  }

  const expectParity = (rows: Row[]) => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toEqual({
        ...row,
        c: getSeverityClass({ severityNumber: row.n, severityText: row.t }),
        type: 'String',
      });
    }
  };

  const cross = (
    numbers: (string | number | null)[],
    texts: (string | null)[],
  ) =>
    numbers.flatMap(n =>
      texts.map(t => `(${sqlLiteral(n)}, ${sqlLiteral(t)})`),
    );

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });
  });

  afterAll(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${DB}.${TABLE}` });
    await hdxClient.close();
    await client.close();
  });

  // Int64 and UInt64 come back as digit strings, as they do in the app.
  it.each([
    ['Nullable(Int64)', 'Nullable(String)', NUMBERS, TEXTS],
    [
      'UInt8',
      'LowCardinality(String)',
      NUMBERS.filter(n => n != null && n >= 0),
      TEXTS.filter(t => t != null),
    ],
    ['UInt64', 'String', [0, 17, '18446744073709551615'], ['warn']],
    ['Float64', 'String', [17, 17.5, 0.5, 1.5, 24.9, 25, -1, NaN], ['warn']],
    [
      'Int32',
      "Enum8('error' = 1, 'Warning' = 2, 'audit' = 3)",
      [-1, 0, 9, 17],
      ['error', 'Warning', 'audit'],
    ],
  ] as const)(
    'matches getSeverityClass for %s numbers and %s text',
    async (numberType, textType, numbers, texts) => {
      expectParity(
        await classify({
          structure: `n ${numberType}, t ${textType}`,
          rows: cross([...numbers], [...texts]),
          numberExpr: 'n',
          textExpr: 't',
        }),
      );
    },
  );

  it('matches getSeverityClass without a text expression', async () => {
    expectParity(
      await classify({
        structure: 'n Nullable(UInt8)',
        rows: NUMBERS.filter(n => n == null || n >= 0).map(sqlLiteral),
        numberExpr: 'n',
      }),
    );
  });

  it('matches getSeverityClass for JSON attributes', async () => {
    expectParity(
      await classify({
        structure: 'j JSON',
        rows: [
          `'{"severity_number": 17, "level": "info"}'`,
          `'{"severity_number": 9.5, "level": "warn"}'`,
          `'{"severity_number": 300, "level": "err"}'`,
          `'{"severity_number": 0, "level": "Crit"}'`,
          `'{"level": "debug"}'`,
        ],
        numberExpr: 'j.severity_number',
        textExpr: 'j.level',
      }),
    );
  });

  describe('as a stored filter', () => {
    const ROWS: [number, string][] = [
      [17, ''],
      [0, 'error'],
      [0, 'critical'],
      [9, 'error'],
      [21, ''],
      [13, 'warning'],
      [0, 'audit'],
      [18, 'info'],
      [0, 'Err'],
      [0, '[warn]'],
      [3, 'debug'],
      [25, ''],
      [0, 'panic'],
      [0, 'INF'],
      [0, 'dbug'],
    ];

    const otelKey = buildSeverityClassExpressionV1({
      numberExpr: 'SeverityNumber',
      textExpr: 'SeverityText',
    });
    // LogAttributes['level'] has a MATERIALIZED column, so renderChartConfig
    // rewrites the filter through node-sql-parser.
    const mapKey = buildSeverityClassExpressionV1({
      numberExpr: 'SeverityNumber',
      textExpr: "LogAttributes['level']",
    });

    beforeAll(async () => {
      await client.command({
        query: `
          CREATE OR REPLACE TABLE ${DB}.${TABLE} (
            Timestamp DateTime64(9),
            SeverityNumber UInt8,
            SeverityText LowCardinality(String),
            LogAttributes Map(LowCardinality(String), String),
            Level String MATERIALIZED LogAttributes['level']
          )
          ENGINE = MergeTree()
          ORDER BY (Timestamp)
        `,
      });
      await client.command({
        query: `
          INSERT INTO ${DB}.${TABLE}
            (Timestamp, SeverityNumber, SeverityText, LogAttributes)
          VALUES ${ROWS.map(
            ([n, t]) =>
              `('2025-06-01 00:00:00', ${n}, ${sqlLiteral(t)}, map('level', ${sqlLiteral(t)}))`,
          ).join(', ')}
        `,
      });
    });

    async function count(
      key: string,
      included: string[],
      excluded: string[] = [],
    ) {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            displayType: DisplayType.Table,
            connection: 'test-connection',
            from: { databaseName: DB, tableName: TABLE },
            select: [{ aggFn: 'count', valueExpression: '', alias: 'count' }],
            where: '',
            whereLanguage: 'sql',
            timestampValueExpression: 'Timestamp',
            dateRange: [new Date('2025-01-01'), new Date('2025-12-31')],
            filters: filtersToQuery({
              [key]: {
                included: new Set(included),
                excluded: new Set(excluded),
              },
            }),
          },
          new Metadata(hdxClient, new MetadataCache()),
          undefined,
        ),
      );
      const result = await client.query({ query: sql, format: 'JSONEachRow' });
      const [row] = await result.json<{ count: string }>();
      return { sql, count: Number(row.count) };
    }

    const jsCount = (matches: (severityClass: string) => boolean) =>
      ROWS.filter(([severityNumber, severityText]) =>
        matches(getSeverityClass({ severityNumber, severityText })),
      ).length;

    it.each([
      ['OTel columns', otelKey],
      ['a map attribute', mapKey],
    ])('counts each class like getSeverityClass on %s', async (_, key) => {
      for (const severityClass of SEVERITY_CLASS_FACET_VALUES) {
        expect((await count(key, [severityClass])).count).toBe(
          jsCount(c => c === severityClass),
        );
      }
      expect((await count(key, [], ['OTHER'])).count).toBe(
        jsCount(c => c !== 'OTHER'),
      );
    });

    it('runs the map key against the materialized column', async () => {
      const { sql } = await count(mapKey, ['ERROR']);
      expect(sql).toContain("Level ILIKE 'err%'");
    });
  });
});
