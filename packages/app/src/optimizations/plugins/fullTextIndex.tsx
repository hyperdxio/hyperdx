import { findTextIndex } from '@hyperdx/common-utils/dist/queryParser';
import {
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Code, List, Stack, Text } from '@mantine/core';

import {
  OptimizationDetectionContext,
  OptimizationFinding,
  OptimizationPlugin,
  RenderFindingProps,
} from '../types';

const PLUGIN_ID = 'full-text-index';

type FullTextFindingDetail = {
  sourceId: string;
  databaseName: string;
  tableName: string;
  implicitColumnExpression: string;
};

async function detect(
  ctx: OptimizationDetectionContext,
): Promise<OptimizationFinding<FullTextFindingDetail>[]> {
  const findings: OptimizationFinding<FullTextFindingDetail>[] = [];

  const eligibleSources = ctx.sources.filter(
    (s): s is TSource & { implicitColumnExpression: string } =>
      (isTraceSource(s) || isLogSource(s)) && !!s.implicitColumnExpression,
  );

  await Promise.all(
    eligibleSources.map(async source => {
      try {
        const indices = await ctx.metadata.getSkipIndices({
          databaseName: source.from.databaseName,
          tableName: source.from.tableName,
          connectionId: source.connection,
        });
        const implicitExpr = source.implicitColumnExpression;
        if (!findTextIndex(indices, implicitExpr)) {
          findings.push({
            scopeId: `source:${source.id}`,
            summary: `Full-text index missing on ${source.from.databaseName}.${source.from.tableName} (${implicitExpr})`,
            detail: {
              sourceId: source.id,
              databaseName: source.from.databaseName,
              tableName: source.from.tableName,
              implicitColumnExpression: implicitExpr,
            },
          });
        }
      } catch (err) {
        console.warn(
          `Failed to read skip indices for ${source.from.databaseName}.${source.from.tableName}`,
          err,
        );
      }
    }),
  );

  return findings;
}

export function buildFullTextIndexDDL(detail: FullTextFindingDetail): string[] {
  const fq = `\`${detail.databaseName}\`.\`${detail.tableName}\``;
  return [
    `ALTER TABLE ${fq}\n  ADD INDEX hdx_implicit_full_text_idx ${detail.implicitColumnExpression} TYPE text(tokenizer='splitByNonAlpha', preprocessor=lower(${detail.implicitColumnExpression}))`,
  ];
}

function FindingExplanation({
  finding,
}: RenderFindingProps<FullTextFindingDetail>) {
  return (
    <Stack gap="xs">
      <Text size="sm">
        HyperDX queries against{' '}
        <Code>{finding.detail.implicitColumnExpression}</Code> on{' '}
        <Code>
          {finding.detail.databaseName}.{finding.detail.tableName}
        </Code>{' '}
        for free-text search and highlighting. A full-text skip index lets
        ClickHouse skip large parts of the table when the search string isn't
        present, dramatically speeding up text search.
      </Text>
      <Text size="sm">The recommended DDL:</Text>
      <List size="sm" spacing={2}>
        <List.Item>
          Adds a <Code>full_text</Code> skip index named{' '}
          <Code>hdx_implicit_full_text_idx</Code>.
        </List.Item>
        <List.Item>
          Granularity 1 — checked at every granule for maximum selectivity.
        </List.Item>
        <List.Item>
          ClickHouse only uses the index for newly-inserted data. To backfill
          existing parts, run{' '}
          <Code>MATERIALIZE INDEX hdx_implicit_full_text_idx</Code> separately
          during a low-traffic window — backfill cost scales with table size.
        </List.Item>
      </List>
    </Stack>
  );
}

export const fullTextIndexPlugin: OptimizationPlugin<FullTextFindingDetail> = {
  id: PLUGIN_ID,
  title: 'Full-text index on implicit column',
  shortLabel: 'Full-text index',
  severity: 'recommended',
  description:
    'Log and trace sources benefit from a full-text skip index on their implicit column expression. Without it, free-text search scans every row.',
  detect,
  renderFinding: props => <FindingExplanation {...props} />,
  resolveSource: (finding, sources) =>
    sources.find(s => s.id === finding.detail.sourceId),
  buildDDL: (finding, _source) => buildFullTextIndexDDL(finding.detail),
};

// Exposed for unit tests; not part of the public plugin contract.
export const __testing = {
  detect,
  buildFullTextIndexDDL,
};
