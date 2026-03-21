import { useCallback, useContext, useMemo, useState } from 'react';
import { sq } from 'date-fns/locale';
import ms from 'ms';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Badge, Flex, Group, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { formatAttributeClause } from '@/utils';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import { ROW_DATA_ALIASES } from './DBRowDataPanel';
import { RowSidePanelContext } from './DBRowSidePanel';
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
  onNavigateToRow?: (
    rowId: string,
    aliasWith: WithClause[],
    label: string,
    sourceKind?: SourceKind,
  ) => void;
  'data-testid'?: string;
}

export function useNestedPanelState(isNested?: boolean) {
  const queryState = {
    contextRowId: useQueryState('contextRowId', parseAsStringEncoded),
    contextRowSource: useQueryState('contextRowSource'),
  };

  const localState = {
    contextRowId: useState<string | null>(null),
    contextRowSource: useState<string | null>(null),
  };

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
  onNavigateToRow,
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

  const { setChildModalOpen } = useContext(RowSidePanelContext);

  const handleRowExpandClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, any>) => {
      const body = row?.['__hdx_body'];
      const fallback = source.kind === SourceKind.Trace ? 'Span' : 'Log';
      const label =
        typeof body === 'string' && body.length > 0
          ? body
          : body != null
            ? JSON.stringify(body)
            : fallback;
      onNavigateToRow?.(
        rowWhere.where,
        rowWhere.aliasWith,
        label,
        source.kind as SourceKind,
      );
    },
    [onNavigateToRow, source.kind],
  );

  const date = useMemo(() => new Date(origTimestamp), [origTimestamp]);

  const newDateRange = useMemo(
    (): [Date, Date] => [
      new Date(date.getTime() - range / 2),
      new Date(date.getTime() + range / 2),
    ],
    [date, range],
  );

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

  const defaultTableSelectExpr =
    source.kind === SourceKind.Log || source.kind === SourceKind.Trace
      ? source.defaultTableSelectExpression
      : undefined;

  const config = useMemo(() => {
    const whereClause = getWhereClause(contextBy);
    if (!dbSqlRowTableConfig)
      return {
        connection: source.connection,
        from: source.from,
        timestampValueExpression: source.timestampValueExpression,
        select: defaultTableSelectExpr || '',
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
    defaultTableSelectExpr,
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
    </>
  );
}
