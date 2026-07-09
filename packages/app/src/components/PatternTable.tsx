import { useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Code, Container, Text } from '@mantine/core';

import { SQLPreview } from '@/components/ChartSQLPreview';
import { RawLogTable } from '@/components/DBRowTable';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { Pattern, useGroupedPatterns } from '@/hooks/usePatterns';

import {
  buildPatternColumnExpression,
  PatternColumnSelector,
} from './Patterns/PatternColumnSelector';
import PatternSidePanel from './PatternSidePanel';

const emptyMap = new Map();

export default function PatternTable({
  config,
  totalCountConfig,
  totalCountQueryKeyPrefix,
  bodyValueExpression,
  patternColumn: externalPatternColumn,
  draftPatternColumn: externalDraftPatternColumn,
  onDraftPatternColumnChange: externalOnDraftPatternColumnChange,
  onSubmit: externalOnSubmit,
  source,
}: {
  config: BuilderChartConfigWithDateRange;
  totalCountConfig: BuilderChartConfigWithDateRange;
  bodyValueExpression: string;
  patternColumn?: string | null;
  draftPatternColumn?: string;
  onDraftPatternColumnChange?: (value: string) => void;
  onSubmit?: () => void;
  totalCountQueryKeyPrefix: string;
  source?: TSource;
}) {
  const SAMPLES = 10_000;

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

  // When external handlers are provided (e.g. search page), the pattern
  // column selector is shown inline and the user can override the expression
  // at runtime. For dashboard/preview tiles, the pattern expression is
  // configured in the tile edit UI (via the config's `select` field) and
  // the PatternColumnSelector is not shown.
  const hasExternalPatternColumn =
    externalOnDraftPatternColumnChange != null && externalOnSubmit != null;

  const effectiveBodyValueExpression = buildPatternColumnExpression({
    patternColumn: externalPatternColumn ?? null,
    fallback: bodyValueExpression,
  });

  const {
    error: totalCountError,
    isLoading: isTotalCountLoading,
    isTotalCountComplete,
    totalCount,
  } = useSearchTotalCount(totalCountConfig, totalCountQueryKeyPrefix);

  const {
    data: groupedResults,
    isLoading: isGroupedPatternsLoading,
    error: groupedPatternsError,
    patternQueryConfig,
  } = useGroupedPatterns({
    config,
    samples: SAMPLES,
    bodyValueExpression: effectiveBodyValueExpression,
    severityTextExpression:
      (source?.kind === SourceKind.Log && source.severityTextExpression) || '',
    statusCodeExpression:
      (source?.kind === SourceKind.Trace && source.statusCodeExpression) || '',
    totalCount,
  });

  const isLoading =
    isTotalCountLoading || !isTotalCountComplete || isGroupedPatternsLoading;

  const error = totalCountError || groupedPatternsError;

  const sortedGroupedResults = useMemo(() => {
    return Object.values(groupedResults).sort(
      (a, b) => b.count - a.count,
    ) as Pattern[];
  }, [groupedResults]);

  return (
    <>
      {hasExternalPatternColumn && (
        <PatternColumnSelector
          sourceId={source?.id}
          value={externalDraftPatternColumn ?? ''}
          onChange={externalOnDraftPatternColumnChange}
          onSubmit={externalOnSubmit}
          dateRange={config.dateRange}
          bodyValueExpression={bodyValueExpression}
        />
      )}
      {error ? (
        <Container style={{ overflow: 'auto' }}>
          <Box mt="lg">
            <Text my="sm" size="sm">
              Error Message:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </Code>
          </Box>
          {error instanceof ClickHouseQueryError && (
            <Box mt="lg">
              <Text my="sm" size="sm">
                Original Query:
              </Text>
              <Code
                block
                style={{
                  whiteSpace: 'pre-wrap',
                }}
              >
                <SQLPreview data={error.query} formatData />
              </Code>
            </Box>
          )}
        </Container>
      ) : (
        <>
          <RawLogTable
            isLive={false}
            wrapLines={true}
            isLoading={isLoading}
            rows={sortedGroupedResults ?? []}
            displayedColumns={[
              '__hdx_pattern_trend',
              'countStr',
              'severityText',
              'pattern',
            ]}
            onRowDetailsClick={row => setSelectedPattern(row as Pattern)}
            hasNextPage={false}
            fetchNextPage={() => {}}
            highlightedLineId={''}
            columnTypeMap={emptyMap}
            generateRowId={row => ({ where: row.id, aliasWith: [] })}
            columnNameMap={{
              __hdx_pattern_trend: 'Trend',
              countStr: 'Count',
              pattern: 'Pattern',
              severityText: 'Level',
            }}
            config={patternQueryConfig}
            showExpandButton={false}
          />
          {selectedPattern && source && (
            <PatternSidePanel
              isOpen
              source={source}
              pattern={selectedPattern}
              bodyValueExpression={effectiveBodyValueExpression}
              onClose={() => setSelectedPattern(null)}
            />
          )}
        </>
      )}
    </>
  );
}
