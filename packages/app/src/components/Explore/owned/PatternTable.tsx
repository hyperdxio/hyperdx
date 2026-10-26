// Explore-owned copy. The shared module stays as it is on main, so this prototype does not conflict with it.
import { useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Code, Container, Text } from '@mantine/core';
import { IconBracketsContain } from '@tabler/icons-react';

import { SQLPreview } from '@/components/ChartSQLPreview';
import EmptyState from '@/components/EmptyState';
import {
  buildPatternColumnExpression,
  patternMatchSqlCondition,
} from '@/components/Patterns/patternColumn';
import { PatternColumnSelector } from '@/components/Patterns/PatternColumnSelector';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { Pattern, useGroupedPatterns } from '@/hooks/usePatterns';
import { getLevelExpression } from '@/source';

import { RawLogTable } from './DBRowTable';
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
  onViewMatchingEvents,
  highlightPatterns = false,
  source,
}: {
  config: BuilderChartConfigWithDateRange;
  totalCountConfig: BuilderChartConfigWithDateRange;
  bodyValueExpression: string;
  patternColumn?: string | null;
  draftPatternColumn?: string;
  onDraftPatternColumnChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Switch the search to events matching this Drain template. */
  onViewMatchingEvents?: (sqlCondition: string) => void;
  /** Explore-only pattern highlighting and empty state. */
  highlightPatterns?: boolean;
  totalCountQueryKeyPrefix: string;
  source?: TSource;
}) {
  const SAMPLES = 10_000;

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

  // Search edits the expression here and applies it with the page query.
  // Explore keeps its picker in the toolbar, and dashboard tiles configure
  // the expression in the editor, so neither passes these handlers.
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
    levelExpression: getLevelExpression(source),
    serviceNameExpression:
      ((source?.kind === SourceKind.Log || source?.kind === SourceKind.Trace) &&
        source.serviceNameExpression) ||
      '',
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

  const handleViewMatchingEvents = (pattern: Pattern) => {
    const sqlCondition = patternMatchSqlCondition(
      effectiveBodyValueExpression,
      pattern.pattern,
    );
    if (sqlCondition == null || onViewMatchingEvents == null) {
      return;
    }
    onViewMatchingEvents(sqlCondition);
  };

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
      ) : highlightPatterns &&
        !isLoading &&
        sortedGroupedResults.length === 0 ? (
        <EmptyState
          h="100%"
          icon={<IconBracketsContain size={32} />}
          title="No patterns found"
          description="No repeating event shapes in this sample of 10,000. Try a different field or a wider time range."
        />
      ) : (
        <>
          <RawLogTable
            isLive={false}
            wrapLines={true}
            formatPatternColumn={highlightPatterns}
            isLoading={isLoading}
            rows={sortedGroupedResults ?? []}
            displayedColumns={[
              '__hdx_pattern_trend',
              'countStr',
              'level',
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
              countStr: highlightPatterns ? 'Est. count' : 'Count',
              pattern: 'Pattern',
              level: 'Level',
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
              onViewMatchingEvents={
                onViewMatchingEvents != null
                  ? () => handleViewMatchingEvents(selectedPattern)
                  : undefined
              }
              highlightPattern={highlightPatterns}
            />
          )}
        </>
      )}
    </>
  );
}
