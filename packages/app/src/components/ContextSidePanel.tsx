import { useCallback, useMemo, useState } from 'react';
import { sq } from 'date-fns/locale';
import ms from 'ms';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Badge, Flex, Group, SegmentedControl } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import SearchInputV2 from '@/SearchInputV2';
import { formatAttributeClause } from '@/utils';

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
}

export default function ContextSubpanel({
  source,
  dbSqlRowTableConfig,
  rowData,
  rowId,
}: ContextSubpanelProps) {
  const QUERY_KEY_PREFIX = 'context';
  const { Timestamp: origTimestamp } = rowData;
  const { whereLanguage: originalLanguage = 'lucene' } =
    dbSqlRowTableConfig ?? {};
  const [range, setRange] = useState<number>(ms('30s'));
  const [contextBy, setContextBy] = useState<ContextBy>(ContextBy.All);
  const { control, watch } = useForm({
    defaultValues: {
      where: '',
      whereLanguage: originalLanguage ?? ('lucene' as 'lucene' | 'sql'),
    },
  });

  const formWhere = watch('where');
  const [debouncedWhere] = useDebouncedValue(formWhere, 1000);

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
  } = rowData.ResourceAttributes ?? {};

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
  ]);

  return (
    config && (
      <Flex direction="column" mih="0px" style={{ flexGrow: 1 }}>
        <Group justify="space-between" p="sm">
          <SegmentedControl
            bg="dark.7"
            color="dark.5"
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
                    tableConnections={tcFromSource(source)}
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
                    tableConnections={tcFromSource(source)}
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
            bg="dark.7"
            color="dark.5"
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
            highlightedLineId={rowId}
            isLive={false}
            config={config}
            queryKeyPrefix={QUERY_KEY_PREFIX}
          />
        </div>
      </Flex>
    )
  );
}
