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
import { RawLogTable } from '@/components/DBRowTable';
import EmptyState from '@/components/EmptyState';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { Pattern, useGroupedPatterns } from '@/hooks/usePatterns';

import {
  buildPatternColumnExpression,
  patternMatchSqlCondition,
} from './Patterns/patternColumn';
import { PatternColumnSelector } from './Patterns/PatternColumnSelector';
import PatternSidePanel from './PatternSidePanel';

const emptyMap = new Map();

export default function PatternTable({
  config,
  totalCountConfig,
  totalCountQueryKeyPrefix,
  bodyValueExpression,
  patternColumn: externalPatternColumn,
  onApplyPatternColumn,
  onViewMatchingEvents,
  source,
}: {
  config: BuilderChartConfigWithDateRange;
  totalCountConfig: BuilderChartConfigWithDateRange;
  bodyValueExpression: string;
  patternColumn?: string | null;
  onApplyPatternColumn?: (value: string) => void;
  /** Switch the search to events matching this Drain template. */
  onViewMatchingEvents?: (sqlCondition: string) => void;
  totalCountQueryKeyPrefix: string;
  source?: TSource;
}) {
  const SAMPLES = 10_000;

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

  // Explore puts the picker in the results toolbar. Search still renders it
  // here, above the table. Dashboard tiles configure the expression in the
  // editor, so they pass neither handler.
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
      {onApplyPatternColumn != null && (
        <Box py="xs">
          <PatternColumnSelector
            tableSource={source}
            value={externalPatternColumn ?? ''}
            onApply={onApplyPatternColumn}
            dateRange={config.dateRange}
            defaultField={bodyValueExpression}
          />
        </Box>
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
      ) : !isLoading && sortedGroupedResults.length === 0 ? (
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
              countStr: 'Est. count',
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
              onViewMatchingEvents={
                onViewMatchingEvents != null
                  ? () => handleViewMatchingEvents(selectedPattern)
                  : undefined
              }
            />
          )}
        </>
      )}
    </>
  );
}
