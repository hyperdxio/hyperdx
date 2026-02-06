import { useCallback, useContext, useMemo, useState } from 'react';
import { sq } from 'date-fns/locale';
import ms from 'ms';
import { parseAsString, useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Badge, Flex, Group, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import SearchInputV2 from '@/SearchInputV2';
import { useSource } from '@/source';
import { formatAttributeClause } from '@/utils';

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
  dbSqlRowTableConfig: ChartConfigWithDateRange | undefined;
  rowData: Record<string, any>;
  rowId: string | undefined;
  breadcrumbPath?: BreadcrumbPath;
  onBreadcrumbClick?: BreadcrumbNavigationCallback;
}

// Custom hook to manage nested panel state
export function useNestedPanelState(isNested?: boolean) {
  // Query state (URL-based) for root level
  const queryState = {
    contextRowId: useQueryState('contextRowId', parseAsString),
    contextRowSource: useQueryState('contextRowSource', parseAsString),
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
  breadcrumbPath = [],
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
      whereLanguage: originalLanguage ?? ('lucene' as 'lucene' | 'sql'),
    },
  });

  const formWhere = useWatch({ control, name: 'where' });
  const [debouncedWhere] = useDebouncedValue(formWhere, 1000);

  // State management for nested panels
  const isNested = breadcrumbPath.length > 0;

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

  /* Functions to help generate WHERE clause based on
     which Context the user chooses (All, Host, Node, etc...).
     Since we support lucene and sql, we need to format the condition 
     based on the language
  */
  const {
    'k8s.node.name': k8sNodeName,
    'k8s.pod.name': k8sPodName,
    'host.name': host,
    'service.name': service,
  } = rowData[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES] ?? {};

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
          value: service,
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
    [k8sNodeName, k8sPodName, host, service, debouncedWhere],
  );

  // Main function to generate WHERE clause based on context
  const getWhereClause = useCallback(
    (contextBy: ContextBy): string => {
      const isSql = originalLanguage === 'sql';
      const mapping = CONTEXT_MAPPING[contextBy];

      if (contextBy === ContextBy.All) {
        return mapping.value;
      }

      if (contextBy === ContextBy.Custom) {
        return mapping.value.trim();
      }

      const attributeClause = formatAttributeClause(
        'ResourceAttributes',
        mapping.field,
        mapping.value,
        isSql,
      );
      return attributeClause;
    },
    [CONTEXT_MAPPING, originalLanguage],
  );

  function generateSegmentedControlData() {
    return [
      { label: 'All', value: ContextBy.All },
      ...(service ? [{ label: 'Service', value: ContextBy.Service }] : []),
      ...(host ? [{ label: 'Host', value: ContextBy.Host }] : []),
      ...(k8sPodName ? [{ label: 'Pod', value: ContextBy.Pod }] : []),
      ...(k8sNodeName ? [{ label: 'Node', value: ContextBy.Node }] : []),
      { label: 'Custom', value: ContextBy.Custom },
    ];
  }

  const config = useMemo(() => {
    const whereClause = getWhereClause(contextBy);
    // missing query info, build config from source with default value
    if (!dbSqlRowTableConfig)
      return {
        connection: source.connection,
        from: source.from,
        timestampValueExpression: source.timestampValueExpression,
        select: source.defaultTableSelectExpression || '',
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
    source.connection,
    source.defaultTableSelectExpression,
    source.from,
    source.timestampValueExpression,
  ]);

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
              <WhereLanguageControlled
                name="whereLanguage"
                control={control}
                sqlInput={
                  originalLanguage === 'lucene' ? null : (
                    <SQLInlineEditorControlled
                      tableConnection={tcFromSource(source)}
                      control={control}
                      name="where"
                      placeholder="SQL WHERE clause (ex. column = 'foo')"
                      language="sql"
                      enableHotkey
                      size="sm"
                    />
                  )
                }
                luceneInput={
                  originalLanguage === 'sql' ? null : (
                    <SearchInputV2
                      tableConnection={tcFromSource(source)}
                      control={control}
                      name="where"
                      language="lucene"
                      placeholder="Lucene where clause (ex. column:value)"
                      enableHotkey
                      size="sm"
                    />
                  )
                }
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
          <Group p="sm">
            <div>
              {contextBy !== ContextBy.All && (
                <Badge size="md" variant="default">
                  {contextBy}:{CONTEXT_MAPPING[contextBy].value}
                </Badge>
              )}
              <Badge size="md" variant="default">
                Time range: ±{ms(range / 2)}
              </Badge>
            </div>
          </Group>
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
            ...breadcrumbPath,
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
