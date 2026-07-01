import { useCallback, useContext, useMemo, useState } from 'react';
import ms from 'ms';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Flex,
  Group,
  ScrollArea,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch, IconX } from '@tabler/icons-react';

import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { useSource } from '@/source';
import { formatAttributeClause } from '@/utils';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import { ROW_DATA_ALIASES } from './DBRowDataPanel';
import DBRowSidePanel, { RowSidePanelContext } from './DBRowSidePanel';
import {
  BreadcrumbNavigationCallback,
  BreadcrumbPath,
} from './DBRowSidePanelHeader';
import { DBSqlRowTable } from './DBRowTable';

interface ContextSubpanelProps {
  source: TSource;
  dbSqlRowTableConfig: BuilderChartConfigWithDateRange | undefined;
  rowData: Record<string, any>;
  rowId: string | undefined;
  breadcrumbPath?: BreadcrumbPath;
  onBreadcrumbClick?: BreadcrumbNavigationCallback;
}

interface QuickFilterItem {
  id: string;
  label: string;
  value: string;
  generateWhere: (isSql: boolean) => string;
}

function formatColumnEquals(
  column: string,
  value: string,
  isSql: boolean,
): string {
  if (isSql) {
    return `${column} = '${value.replace(/'/g, "''")}'`;
  }
  return `${column}:"${value.replace(/"/g, '\\"')}"`;
}

const PROMOTED_RESOURCE_ATTR_KEYS = [
  'host.name',
  'k8s.pod.name',
  'k8s.node.name',
];

function extractQuickFilters(
  rowData: Record<string, any>,
  source: TSource,
): QuickFilterItem[] {
  const filters: QuickFilterItem[] = [];
  const skipAliases = new Set<string>(Object.values(ROW_DATA_ALIASES));

  const serviceNameExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.serviceNameExpression
      : undefined;
  const resourceAttrExpr =
    'resourceAttributesExpression' in source
      ? source.resourceAttributesExpression
      : undefined;
  const eventAttrExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.eventAttributesExpression
      : undefined;

  const resourceAttrs = rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES] as
    | Record<string, unknown>
    | undefined;

  // Service name pill (promoted, always first)
  const serviceNameValue = rowData[ROW_DATA_ALIASES.SERVICE_NAME];
  if (serviceNameExpr && serviceNameValue) {
    filters.push({
      id: 'svc',
      label: serviceNameExpr,
      value: String(serviceNameValue),
      generateWhere: isSql =>
        formatColumnEquals(serviceNameExpr, String(serviceNameValue), isSql),
    });
  } else if (
    resourceAttrs?.['service.name'] &&
    typeof resourceAttrs['service.name'] === 'string' &&
    resourceAttrExpr
  ) {
    filters.push({
      id: 'ra:service.name',
      label: 'service.name',
      value: String(resourceAttrs['service.name']),
      generateWhere: isSql =>
        formatAttributeClause(
          resourceAttrExpr,
          'service.name',
          String(resourceAttrs['service.name']),
          isSql,
        ),
    });
  }

  // Promoted resource attribute pills (host, k8s)
  if (resourceAttrs && resourceAttrExpr) {
    for (const key of PROMOTED_RESOURCE_ATTR_KEYS) {
      const val = resourceAttrs[key];
      if (typeof val !== 'string' || !val) continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, val, isSql),
      });
    }
  }

  // Remaining resource attributes
  const addedIds = new Set(filters.map(f => f.id));
  if (resourceAttrs && resourceAttrExpr) {
    for (const [key, val] of Object.entries(resourceAttrs)) {
      if (addedIds.has(`ra:${key}`)) continue;
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, val, isSql),
      });
    }
  }

  // Event attributes
  const eventAttrs = rowData[ROW_DATA_ALIASES.EVENT_ATTRIBUTES];
  if (eventAttrs && typeof eventAttrs === 'object' && eventAttrExpr) {
    for (const [key, val] of Object.entries(
      eventAttrs as Record<string, unknown>,
    )) {
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      filters.push({
        id: `ea:${key}`,
        label: key,
        value: val,
        generateWhere: isSql =>
          formatAttributeClause(eventAttrExpr, key, val, isSql),
      });
    }
  }

  // Top-level columns
  for (const [key, val] of Object.entries(rowData)) {
    if (skipAliases.has(key) || key.startsWith('__hdx_')) continue;
    if (typeof val !== 'string' || !val || val.length > 200) continue;
    if (/timestamp|ttl/i.test(key)) continue;
    if (serviceNameExpr && key === serviceNameExpr) continue;

    filters.push({
      id: `col:${key}`,
      label: key,
      value: String(val),
      generateWhere: isSql => formatColumnEquals(key, String(val), isSql),
    });
  }

  return filters;
}

const filterPillStyle = {
  display: 'inline-flex',
  alignItems: 'center' as const,
  gap: 4,
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: '20px',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  maxWidth: 400,
  overflow: 'hidden',
};

function FilterPill({
  filter,
  isSelected,
  onToggle,
}: {
  filter: QuickFilterItem;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      label={`${filter.label} = ${filter.value}`}
      openDelay={400}
      maw={400}
      multiline
    >
      <span
        data-testid={`context-filter-${filter.id}`}
        onClick={onToggle}
        style={{
          ...filterPillStyle,
          backgroundColor: isSelected ? 'var(--color-bg-hover)' : 'transparent',
          border: isSelected
            ? '1px solid var(--color-border-emphasis)'
            : '1px solid var(--color-border)',
          opacity: isSelected ? 1 : 0.7,
        }}
      >
        <Text span size="xs" c="dimmed" fw={500} style={{ flexShrink: 0 }}>
          {filter.label}
        </Text>
        <Text span size="xs" c="dimmed">
          =
        </Text>
        <Text
          span
          size="xs"
          fw={500}
          truncate
          style={{ maxWidth: 180, display: 'inline-block' }}
        >
          {filter.value}
        </Text>
        {isSelected && (
          <IconX
            size={12}
            style={{ flexShrink: 0, marginLeft: 2 }}
            aria-label="Remove filter"
          />
        )}
      </span>
    </Tooltip>
  );
}

// Custom hook to manage nested panel state
export function useNestedPanelState(isNested?: boolean) {
  // Query state (URL-based) for root level
  const queryState = {
    contextRowId: useQueryState('contextRowId', parseAsStringEncoded),
    // Source IDs are MongoDB ObjectIDs (hex strings) and contain no special
    // characters, so no encoding is needed here.
    contextRowSource: useQueryState('contextRowSource'),
  };

  // Local state for nested levels
  const localState = {
    contextRowId: useState<string | null>(null),
    contextRowSource: useState<string | null>(null),
  };

  // Choose which state to use based on nesting level
  const activeState = isNested ? localState : queryState;

  return {
    contextRowId: activeState.contextRowId[0],
    contextRowSource: activeState.contextRowSource[0],
    setContextRowId: activeState.contextRowId[1],
    setContextRowSource: activeState.contextRowSource[1],
  };
}

export default function ContextSubpanel({
  source,
  dbSqlRowTableConfig,
  rowData,
  rowId,
  breadcrumbPath,
  onBreadcrumbClick,
}: ContextSubpanelProps) {
  const QUERY_KEY_PREFIX = 'context';
  const origTimestamp = rowData[ROW_DATA_ALIASES.TIMESTAMP];
  const { whereLanguage: originalLanguage = 'lucene' } =
    dbSqlRowTableConfig ?? {};
  const [range, setRange] = useState<number>(ms('30s'));
  const [showCustomSearch, setShowCustomSearch] = useState(false);
  const { control } = useForm({
    defaultValues: {
      where: '',
      whereLanguage:
        originalLanguage ??
        getStoredLanguage() ??
        ('lucene' as 'lucene' | 'sql'),
    },
  });

  const formWhere = useWatch({ control, name: 'where' });
  const [debouncedWhere] = useDebouncedValue(formWhere, 1000);

  // State management for nested panels
  const isNested = !!breadcrumbPath?.length;

  const {
    contextRowId,
    contextRowSource,
    setContextRowId,
    setContextRowSource,
  } = useNestedPanelState(isNested);

  const { data: contextRowSidePanelSource } = useSource({
    id: contextRowSource || '',
  });

  const [contextAliasWith, setContextAliasWith] = useState<WithClause[]>([]);

  const handleContextSidePanelClose = useCallback(() => {
    setContextRowId(null);
    setContextRowSource(null);
  }, [setContextRowId, setContextRowSource]);

  const { setChildModalOpen } = useContext(RowSidePanelContext);

  const handleRowExpandClick = useCallback(
    (rowWhere: RowWhereResult) => {
      setContextRowId(rowWhere.where);
      setContextAliasWith(rowWhere.aliasWith);
      setContextRowSource(source.id);
    },
    [source.id, setContextRowId, setContextRowSource],
  );

  const date = useMemo(() => new Date(origTimestamp), [origTimestamp]);

  const newDateRange = useMemo(
    (): [Date, Date] => [
      new Date(date.getTime() - range / 2),
      new Date(date.getTime() + range / 2),
    ],
    [date, range],
  );

  // Filter state
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);

  const availableQuickFilters = useMemo(
    () => extractQuickFilters(rowData, source),
    [rowData, source],
  );

  const toggleFilter = useCallback((id: string) => {
    setSelectedFilterIds(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id],
    );
  }, []);

  const getWhereClause = useCallback((): string => {
    const isSql = originalLanguage === 'sql';
    const clauses: string[] = [];

    for (const filterId of selectedFilterIds) {
      const filter = availableQuickFilters.find(f => f.id === filterId);
      if (filter) {
        clauses.push(filter.generateWhere(isSql));
      }
    }

    if (showCustomSearch && debouncedWhere?.trim()) {
      clauses.push(debouncedWhere.trim());
    }

    if (clauses.length === 0) return '';
    if (clauses.length === 1) return clauses[0];
    return clauses.map(c => `(${c})`).join(' AND ');
  }, [
    originalLanguage,
    selectedFilterIds,
    availableQuickFilters,
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
        whereLanguage: originalLanguage,
        dateRange: newDateRange,
      };

    return {
      ...dbSqlRowTableConfig,
      where: whereClause,
      whereLanguage: originalLanguage,
      dateRange: newDateRange,
      filters: [],
    };
  }, [
    dbSqlRowTableConfig,
    getWhereClause,
    originalLanguage,
    newDateRange,
    source,
  ]);

  return (
    <>
      {config && (
        <Flex direction="column" mih="0px" style={{ flexGrow: 1 }}>
          <Group justify="space-between" p="sm" gap="xs">
            <Group gap="xs">
              <Badge size="md" variant="default">
                ±{ms(range / 2)}
              </Badge>
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
            <Group gap="xs">
              <Tooltip label="Custom search query" openDelay={300}>
                <ActionIcon
                  size="sm"
                  variant={showCustomSearch ? 'secondary' : 'subtle'}
                  onClick={() => setShowCustomSearch(v => !v)}
                >
                  <IconSearch size={14} />
                </ActionIcon>
              </Tooltip>
              {selectedFilterIds.length > 0 && (
                <Text
                  size="xxs"
                  c="dimmed"
                  style={{ cursor: 'pointer' }}
                  td="underline"
                  onClick={() => setSelectedFilterIds([])}
                >
                  Clear filters
                </Text>
              )}
            </Group>
          </Group>
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
          {availableQuickFilters.length > 0 && (
            <ScrollArea
              px="sm"
              pb="xs"
              type="auto"
              offsetScrollbars
              style={{ flexShrink: 0 }}
            >
              <Flex gap={4} wrap="wrap">
                {availableQuickFilters.map(filter => (
                  <FilterPill
                    key={filter.id}
                    filter={filter}
                    isSelected={selectedFilterIds.includes(filter.id)}
                    onToggle={() => toggleFilter(filter.id)}
                  />
                ))}
              </Flex>
            </ScrollArea>
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
      {contextRowId && contextRowSidePanelSource && (
        <DBRowSidePanel
          source={contextRowSidePanelSource}
          rowId={contextRowId}
          aliasWith={contextAliasWith}
          onClose={handleContextSidePanelClose}
          isNestedPanel={true}
          breadcrumbPath={[
            ...(breadcrumbPath ?? []),
            {
              label: `Surrounding Context`,
              rowData,
            },
          ]}
          onBreadcrumbClick={onBreadcrumbClick}
        />
      )}
    </>
  );
}
