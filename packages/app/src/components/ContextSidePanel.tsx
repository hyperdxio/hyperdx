import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import ms from 'ms';
import { ErrorBoundary } from 'react-error-boundary';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, Group, ScrollArea, SegmentedControl, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';

import {
  buildContextWhereClause,
  extractQuickFilters,
  FilterLegend,
  FilterPill,
  getAvailablePresets,
  getPresetFilterIds,
} from './ContextFilterPills';
import { ROW_DATA_ALIASES } from './DBRowDataPanel';
import { RowSidePanelContext } from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';

interface ContextSubpanelProps {
  source: TSource;
  dbSqlRowTableConfig: BuilderChartConfigWithDateRange | undefined;
  rowData: Record<string, any>;
  rowId: string | undefined;
  onNavigateToRow?: (
    rowId: string,
    aliasWith: WithClause[],
    label: string,
    sourceKind?: SourceKind,
  ) => void;
  'data-testid'?: string;
}

export default function ContextSubpanel({
  source,
  dbSqlRowTableConfig,
  rowData,
  rowId,
  onNavigateToRow,
  'data-testid': dataTestId,
}: ContextSubpanelProps) {
  const QUERY_KEY_PREFIX = 'context';
  const origTimestamp = rowData[ROW_DATA_ALIASES.TIMESTAMP];
  const { whereLanguage: originalLanguage = 'lucene' } =
    dbSqlRowTableConfig ?? {};
  const [range, setRange] = useState<number>(ms('30s'));
  const [activePreset, setActivePreset] = useState('all');
  const { control, reset } = useForm({
    defaultValues: {
      where: '',
      whereLanguage:
        originalLanguage ??
        getStoredLanguage() ??
        ('lucene' as 'lucene' | 'sql'),
    },
  });

  const formWhere = useWatch({ control, name: 'where' });
  const formWhereLanguage = useWatch({ control, name: 'whereLanguage' });
  const [debouncedWhere] = useDebouncedValue(formWhere, 1000);
  const effectiveWhereLanguage = formWhereLanguage || originalLanguage;

  const { setChildModalOpen } = useContext(RowSidePanelContext);

  const handleRowExpandClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, any>) => {
      const body = row?.[ROW_DATA_ALIASES.BODY];
      const fallback = isTraceSource(source) ? 'Span' : 'Log';
      const label =
        typeof body === 'string' && body.length > 0
          ? body
          : body != null
            ? JSON.stringify(body)
            : fallback;
      onNavigateToRow?.(rowWhere.where, rowWhere.aliasWith, label, source.kind);
    },
    [onNavigateToRow, source],
  );

  const date = useMemo(() => new Date(origTimestamp), [origTimestamp]);
  const newDateRange = useMemo(
    (): [Date, Date] => [
      new Date(date.getTime() - range / 2),
      new Date(date.getTime() + range / 2),
    ],
    [date, range],
  );

  // Filter state — showCustomSearch is derived, not stored
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const showCustomSearch = activePreset === 'custom';

  useEffect(() => {
    setSelectedFilterIds([]);
    setActivePreset('all');
    reset({
      where: '',
      whereLanguage: originalLanguage,
    });
  }, [originalLanguage, reset, rowId]);

  const availableFilters = useMemo(
    () => extractQuickFilters(rowData, source),
    [rowData, source],
  );

  const presetOptions = useMemo(
    () => getAvailablePresets(availableFilters),
    [availableFilters],
  );

  const handlePresetChange = useCallback(
    (preset: string) => {
      setActivePreset(preset);
      if (preset === 'custom' || preset === 'all') {
        setSelectedFilterIds([]);
        return;
      }
      const ids = getPresetFilterIds(preset, availableFilters);
      setSelectedFilterIds(ids);
    },
    [availableFilters],
  );

  const toggleFilter = useCallback((id: string) => {
    setSelectedFilterIds(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id],
    );
    setActivePreset('custom');
  }, []);

  const getWhereClause = useCallback((): string => {
    return buildContextWhereClause({
      selectedFilterIds,
      availableFilters,
      isSql: effectiveWhereLanguage === 'sql',
      customWhere: showCustomSearch ? debouncedWhere : '',
    });
  }, [
    effectiveWhereLanguage,
    selectedFilterIds,
    availableFilters,
    showCustomSearch,
    debouncedWhere,
  ]);

  const config = useMemo(() => {
    const whereClause = getWhereClause();
    if (!dbSqlRowTableConfig)
      return {
        connection: source.connection,
        from: source.from,
        timestampValueExpression: source.timestampValueExpression,
        select:
          ((isLogSource(source) || isTraceSource(source)) &&
            source.defaultTableSelectExpression) ||
          '',
        limit: { limit: 200 },
        orderBy: `${source.timestampValueExpression} DESC`,
        where: whereClause,
        whereLanguage: effectiveWhereLanguage,
        dateRange: newDateRange,
      };

    return {
      ...dbSqlRowTableConfig,
      where: whereClause,
      whereLanguage: effectiveWhereLanguage,
      dateRange: newDateRange,
      filters: [],
    };
  }, [
    dbSqlRowTableConfig,
    effectiveWhereLanguage,
    getWhereClause,
    newDateRange,
    source,
  ]);

  const displayedPreset =
    selectedFilterIds.length === 0 && activePreset !== 'custom'
      ? 'all'
      : activePreset;

  return (
    <>
      {config && (
        <Flex
          direction="column"
          mih="0px"
          style={{ flexGrow: 1 }}
          data-testid={dataTestId}
        >
          <Group gap="xs" p="sm" pb={4}>
            <Text size="xs" c="dimmed" fw={500}>
              ±{ms(range / 2)}
            </Text>
            <SegmentedControl
              size="xs"
              data={[
                { label: '100ms', value: ms('100ms').toString() },
                { label: '500ms', value: ms('500ms').toString() },
                { label: '1s', value: ms('1s').toString() },
                { label: '5s', value: ms('5s').toString() },
                { label: '30s', value: ms('30s').toString() },
                { label: '1m', value: ms('1m').toString() },
                { label: '5m', value: ms('5m').toString() },
                { label: '15m', value: ms('15m').toString() },
              ]}
              value={range.toString()}
              onChange={value => setRange(Number(value))}
            />
          </Group>
          <Flex direction="column" px="sm" pb="xs" gap={6}>
            <Text size="xxs" c="dimmed" fw={600} tt="uppercase">
              Match on
            </Text>
            <SegmentedControl
              size="xs"
              data={presetOptions}
              value={displayedPreset}
              onChange={handlePresetChange}
              style={{ width: 'fit-content' }}
            />
          </Flex>
          {showCustomSearch && (
            <Group px="sm" pb="xs">
              <SearchWhereInput
                tableConnection={tcFromSource(source)}
                control={control}
                name="where"
                enableHotkey
                size="xs"
              />
            </Group>
          )}
          {availableFilters.length > 0 && (
            <ErrorBoundary
              fallbackRender={() => (
                <Text size="xs" c="dimmed" px="sm">
                  Unable to load event filters.
                </Text>
              )}
            >
              <Flex direction="column" px="sm" pb="xs" gap={4}>
                <Group justify="space-between">
                  <Text size="xs">
                    Matching on{' '}
                    <Text span fw={700}>
                      {selectedFilterIds.length}
                    </Text>{' '}
                    attributes
                  </Text>
                  {selectedFilterIds.length > 0 && (
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedFilterIds([]);
                        setActivePreset('all');
                      }}
                    >
                      Clear all
                    </Text>
                  )}
                </Group>
                <ScrollArea mah={180} type="auto" offsetScrollbars>
                  <Flex gap={5} wrap="wrap">
                    {availableFilters.map(filter => (
                      <FilterPill
                        key={filter.id}
                        filter={filter}
                        isSelected={selectedFilterIds.includes(filter.id)}
                        onToggle={() => toggleFilter(filter.id)}
                      />
                    ))}
                  </Flex>
                </ScrollArea>
                <FilterLegend />
              </Flex>
            </ErrorBoundary>
          )}
          <div style={{ height: '100%', overflow: 'auto' }}>
            <DBSqlRowTable
              sourceId={source.id}
              highlightedLineId={rowId}
              showExpandButton={false}
              isLive={false}
              config={config}
              queryKeyPrefix={QUERY_KEY_PREFIX}
              onRowDetailsClick={handleRowExpandClick}
              onChildModalOpen={setChildModalOpen}
            />
          </div>
        </Flex>
      )}
    </>
  );
}
