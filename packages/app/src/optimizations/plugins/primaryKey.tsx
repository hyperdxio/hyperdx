import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Code, List, Stack, Text } from '@mantine/core';

import { SQLPreview } from '@/components/ChartSQLPreview';

import {
  OptimizationDetectionContext,
  OptimizationFinding,
  OptimizationPlugin,
  RenderFindingProps,
} from '../types';

const PLUGIN_ID = 'primary-key';

type SupportedKind = SourceKind.Log | SourceKind.Trace;

// The default primary keys HyperDX (and the upstream OTel ClickHouse exporter)
// emit on initial table creation. We only want to surface the recommendation
// when the user is still on those defaults — once they've customized the PK
// we assume they had a reason and we don't want to second-guess it.
const DEFAULTS: Record<
  SupportedKind,
  { current: string; recommended: string }
> = {
  [SourceKind.Log]: {
    current: 'ServiceName, TimestampTime',
    recommended: 'toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp',
  },
  [SourceKind.Trace]: {
    current: 'ServiceName, SpanName, toDateTime(Timestamp)',
    recommended:
      'toStartOfFiveMinutes(Timestamp), ServiceName, SpanName, Timestamp',
  },
};

type PKFindingDetail = {
  sourceId: string;
  databaseName: string;
  tableName: string;
  currentPrimaryKey: string;
  recommendedPrimaryKey: string;
  sourceKind: SupportedKind;
};

function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

function pkMatches(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

async function detect(
  ctx: OptimizationDetectionContext,
): Promise<OptimizationFinding<PKFindingDetail>[]> {
  const findings: OptimizationFinding<PKFindingDetail>[] = [];

  const eligible = ctx.sources.filter(
    (s): s is TSource & { kind: SupportedKind } =>
      s.kind === SourceKind.Log || s.kind === SourceKind.Trace,
  );

  await Promise.all(
    eligible.map(async source => {
      try {
        const meta = await ctx.metadata.getTableMetadata({
          databaseName: source.from.databaseName,
          tableName: source.from.tableName,
          connectionId: source.connection,
        });
        if (!meta?.primary_key) return;

        const defaults = DEFAULTS[source.kind];
        if (!pkMatches(meta.primary_key, defaults.current)) return;

        findings.push({
          scopeId: `source:${source.id}`,
          summary: `Default primary key present — switch to a time-bucketed PK for better performance`,
          detail: {
            sourceId: source.id,
            databaseName: source.from.databaseName,
            tableName: source.from.tableName,
            currentPrimaryKey: meta.primary_key,
            recommendedPrimaryKey: defaults.recommended,
            sourceKind: source.kind,
          },
        });
      } catch (err) {
        console.warn(
          `Failed to read table metadata for ${source.from.databaseName}.${source.from.tableName}`,
          err,
        );
      }
    }),
  );

  return findings;
}

function FindingExplanation({ finding }: RenderFindingProps<PKFindingDetail>) {
  return (
    <Stack gap="xs">
      <Text size="sm">
        ClickHouse uses the primary key to order data on disk and to skip large
        portions of the table during reads. Logs and traces are dominated by
        recent-time queries, so leading the PK with a coarse time bucket (
        <Code>toStartOfFiveMinutes(Timestamp)</Code>) yields better granule
        pruning for many query patterns.
      </Text>

      <Text size="sm" fw={500}>
        Current primary key:
      </Text>
      <SQLPreview
        data={finding.detail.currentPrimaryKey}
        formatData={false}
        enableLineWrapping
      />

      <Text size="sm" fw={500}>
        Recommended primary key:
      </Text>
      <SQLPreview
        data={finding.detail.recommendedPrimaryKey}
        formatData={false}
        enableLineWrapping
      />

      <Text size="sm" c="dimmed">
        Changing a primary key re-sorts the table on disk, so this isn&apos;t
        safe to auto-apply. The typical migration is:
      </Text>
      <List size="sm" spacing={2}>
        <List.Item>
          Create a new table with the recommended <Code>PRIMARY KEY</Code> /
          <Code> ORDER BY</Code>.
        </List.Item>
        <List.Item>
          Backfill in time-windowed batches with{' '}
          <Code>INSERT INTO new SELECT * FROM old WHERE Timestamp …</Code>.
        </List.Item>
        <List.Item>
          Atomically swap with <Code>EXCHANGE TABLES new AND old</Code> once the
          backfill catches up.
        </List.Item>
        <List.Item>
          Use EXCHANGE to atomically swap the new and old tables
        </List.Item>
      </List>
    </Stack>
  );
}

export const primaryKeyPlugin: OptimizationPlugin<PKFindingDetail> = {
  id: PLUGIN_ID,
  title: 'Time-bucketed primary key',
  shortLabel: 'Primary key',
  severity: 'recommended',
  description:
    'Log and traces schemas benefit from a bucketed timestamp at the start of the primary key.',
  detect,
  renderFinding: props => <FindingExplanation {...props} />,
  resolveSource: (finding, sources) =>
    sources.find(s => s.id === finding.detail.sourceId),
};

// Test-only helpers; not part of the public plugin contract.
export const __testing = {
  detect,
  pkMatches,
  DEFAULTS,
};
