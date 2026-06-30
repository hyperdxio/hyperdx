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
import { IconPlus, IconX } from '@tabler/icons-react';

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

enum ContextBy {
  All = 'all',
  Custom = 'custom',
  Host = 'host',
  Node = 'k8s.node.name',
  Pod = 'k8s.pod.name',
  Service = 'service',
}

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

  const resourceAttrs = rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES];
  if (resourceAttrs && typeof resourceAttrs === 'object' && resourceAttrExpr) {
    for (const [key, val] of Object.entries(resourceAttrs)) {
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      if (key === 'service.name' && serviceNameExpr) continue;
      filters.push({
        id: `ra:${key}`,
        label: key,
        value: String(val),
        generateWhere: isSql =>
          formatAttributeClause(resourceAttrExpr, key, String(val), isSql),
      });
    }
  }

  const eventAttrs = rowData[ROW_DATA_ALIASES.EVENT_ATTRIBUTES];
  if (eventAttrs && typeof eventAttrs === 'object' && eventAttrExpr) {
    for (const [key, val] of Object.entries(eventAttrs)) {
      if (typeof val !== 'string' || !val || val.length > 200) continue;
      filters.push({
        id: `ea:${key}`,
        label: key,
        value: String(val),
        generateWhere: isSql =>
          formatAttributeClause(eventAttrExpr, key, String(val), isSql),
      });
    }
  }

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

const quickFilterPillStyle = {
  display: 'inline-flex',
  alignItems: 'center' as const,
  gap: 4,
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 11,
  lineHeight: '18px',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  maxWidth: 260,
  overflow: 'hidden',
};

function QuickFilterPill({
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
      label={`${isSelected ? 'Remove' : 'Add'} filter: ${filter.label} = ${filter.value}`}
      openDelay={300}
    >
      <span
        data-testid={`quick-filter-${filter.id}`}
        onClick={onToggle}
        style={{
          ...quickFilterPillStyle,
          backgroundColor: isSelected ? 'var(--color-bg-hover)' : 'transparent',
          border: isSelected
            ? '1px solid var(--color-border-emphasis)'
            : '1px dashed var(--color-border)',
        }}
      >
        <Text
          span
          size="xxs"
          c="dimmed"
          fw={500}
          style={{ flexShrink: 0, maxWidth: 100 }}
          truncate="start"
        >
          {filter.label}
        </Text>
        <Text span size="xxs" c="dimmed">
          {' = '}
        </Text>
        <Text span size="xxs" fw={500} truncate>
          {filter.value}
        </Text>
        {isSelected ? (
          <IconX size={9} style={{ flexShrink: 0, marginLeft: 2 }} />
        ) : (
          <IconPlus size={9} style={{ flexShrink: 0, marginLeft: 2 }} />
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
  const [contextBy, setContextBy] = useState<ContextBy>(ContextBy.All);
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

  // Extract source-specific expressions
  const serviceNameExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.serviceNameExpression
      : undefined;
  const serviceName = rowData[ROW_DATA_ALIASES.SERVICE_NAME] as
    | string
    | undefined;
  const resourceAttrExpr =
    'resourceAttributesExpression' in source
      ? source.resourceAttributesExpression
      : undefined;

  const {
    'k8s.node.name': k8sNodeName,
    'k8s.pod.name': k8sPodName,
    'host.name': host,
    'service.name': service,
  } = rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES] ?? {};

  // Resolve effective service name: prefer serviceNameExpression, fall back to
  // resource attribute
  const effectiveServiceName = serviceName || service;

  // Quick filter state
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [showQuickFilters, setShowQuickFilters] = useState(false);

  const availableQuickFilters = useMemo(
    () => extractQuickFilters(rowData, source),
    [rowData, source],
  );

  const toggleQuickFilter = useCallback((id: string) => {
    setSelectedFilterIds(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id],
    );
  }, []);

  const CONTEXT_MAPPING = useMemo(
    () =>
      ({
        [ContextBy.All]: {
          field: '',
          value: '',
        },
        [ContextBy.Custom]: {
          field: '',
          value: debouncedWhere || '',
        },
        [ContextBy.Service]: {
          field: 'service.name',
          value: effectiveServiceName,
        },
        [ContextBy.Host]: {
          field: 'host.name',
          value: host,
        },
        [ContextBy.Pod]: {
          field: 'k8s.pod.name',
          value: k8sPodName,
        },
        [ContextBy.Node]: {
          field: 'k8s.node.name',
          value: k8sNodeName,
        },
      }) as const,
    [k8sNodeName, k8sPodName, host, effectiveServiceName, debouncedWhere],
  );

  const getWhereClause = useCallback(
    (contextBy: ContextBy): string => {
      const isSql = originalLanguage === 'sql';
      const clauses: string[] = [];

      if (contextBy === ContextBy.Custom) {
        const customWhere = CONTEXT_MAPPING[contextBy].value.trim();
        if (customWhere) {
          clauses.push(customWhere);
        }
      } else if (contextBy === ContextBy.Service) {
        if (serviceNameExpr && serviceName) {
          clauses.push(formatColumnEquals(serviceNameExpr, serviceName, isSql));
        } else if (service) {
          clauses.push(
            formatAttributeClause(
              resourceAttrExpr || 'ResourceAttributes',
              'service.name',
              service,
              isSql,
            ),
          );
        }
      } else if (contextBy !== ContextBy.All) {
        const mapping = CONTEXT_MAPPING[contextBy];
        if (mapping.value) {
          clauses.push(
            formatAttributeClause(
              resourceAttrExpr || 'ResourceAttributes',
              mapping.field,
              mapping.value,
              isSql,
            ),
          );
        }
      }

      for (const filterId of selectedFilterIds) {
        const filter = availableQuickFilters.find(f => f.id === filterId);
        if (filter) {
          clauses.push(filter.generateWhere(isSql));
        }
      }

      if (clauses.length === 0) return '';
      if (clauses.length === 1) return clauses[0];
      return clauses.map(c => `(${c})`).join(' AND ');
    },
    [
      CONTEXT_MAPPING,
      originalLanguage,
      serviceNameExpr,
      serviceName,
      service,
      resourceAttrExpr,
      selectedFilterIds,
      availableQuickFilters,
    ],
  );

  function generateSegmentedControlData() {
    return [
      { label: 'All', value: ContextBy.All },
      ...(effectiveServiceName
        ? [{ label: 'Service', value: ContextBy.Service }]
        : []),
      ...(host ? [{ label: 'Host', value: ContextBy.Host }] : []),
      ...(k8sPodName ? [{ label: 'Pod', value: ContextBy.Pod }] : []),
      ...(k8sNodeName ? [{ label: 'Node', value: ContextBy.Node }] : []),
      { label: 'Custom', value: ContextBy.Custom },
    ];
  }

  const config = useMemo(() => {
    const whereClause = getWhereClause(contextBy);
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
    contextBy,
    source,
  ]);

  const activeQuickFilterLabels = selectedFilterIds
    .map(id => {
      const filter = availableQuickFilters.find(f => f.id === id);
      return filter ? `${filter.label}=${filter.value}` : null;
    })
    .filter(Boolean);

  return (
    <>
      {config && (
        <Flex direction="column" mih="0px" style={{ flexGrow: 1 }}>
          <Group justify="space-between" p="sm">
            <SegmentedControl
              size="xs"
              data={generateSegmentedControlData()}
              value={contextBy}
              onChange={v => setContextBy(v as ContextBy)}
            />
            {contextBy === ContextBy.Custom && (
              <SearchWhereInput
                tableConnection={tcFromSource(source)}
                control={control}
                name="where"
                enableHotkey
                size="xs"
              />
            )}
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
          <Group px="sm" pb="xs" gap="xs">
            <div>
              {contextBy !== ContextBy.All &&
                contextBy !== ContextBy.Custom && (
                  <Badge size="md" variant="default" mr={4}>
                    {contextBy}:{CONTEXT_MAPPING[contextBy].value}
                  </Badge>
                )}
              {contextBy === ContextBy.Custom && debouncedWhere && (
                <Badge size="md" variant="default" mr={4}>
                  custom query
                </Badge>
              )}
              {activeQuickFilterLabels.map(label => (
                <Badge key={label} size="md" variant="default" mr={4}>
                  {label}
                </Badge>
              ))}
              <Badge size="md" variant="default">
                Time range: ±{ms(range / 2)}
              </Badge>
            </div>
          </Group>
          {availableQuickFilters.length > 0 && (
            <Group px="sm" pb="xs" gap="xs" align="center">
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={() => setShowQuickFilters(v => !v)}
                title={
                  showQuickFilters ? 'Hide event filters' : 'Show event filters'
                }
              >
                <IconPlus
                  size={12}
                  style={{
                    transform: showQuickFilters
                      ? 'rotate(45deg)'
                      : 'rotate(0deg)',
                    transition: 'transform 150ms',
                  }}
                />
              </ActionIcon>
              <Text size="xxs" c="dimmed">
                Event Filters
              </Text>
              {selectedFilterIds.length > 0 && (
                <Text
                  size="xxs"
                  c="dimmed"
                  style={{ cursor: 'pointer' }}
                  td="underline"
                  onClick={() => setSelectedFilterIds([])}
                >
                  Clear all
                </Text>
              )}
            </Group>
          )}
          {showQuickFilters && availableQuickFilters.length > 0 && (
            <ScrollArea px="sm" pb="xs" type="auto" offsetScrollbars>
              <Flex gap={4} wrap="wrap">
                {availableQuickFilters.map(filter => (
                  <QuickFilterPill
                    key={filter.id}
                    filter={filter}
                    isSelected={selectedFilterIds.includes(filter.id)}
                    onToggle={() => toggleQuickFilter(filter.id)}
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
