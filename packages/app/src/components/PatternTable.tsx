import { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import {
  convertDateRangeToGranularityString,
  timeBucketByGranularity,
  toStartOfInterval,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import {
  RawLogTable,
  selectColumnMapWithoutAdditionalKeys,
  useConfigWithPrimaryAndPartitionKey,
} from './DBRowTable';
import { useSearchTotalCount } from './SearchTotalCountChart';

// We don't want to load pyodide over and over again, use react query to cache the async instance
function usePyodide() {
  return useQuery({
    queryKey: ['pyodide'],
    queryFn: async () => {
      // @ts-ignore
      const pyodide = await window.loadPyodide();
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');
      const url = new URL(
        '/drain3-0.9.11-py3-none-any.whl',
        window.location.origin,
      );
      await micropip.install(url.href);
      return pyodide;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
  });
}

async function mineEventPatterns(logs: string[], pyodide: any) {
  pyodide.globals.set('HDXLOGS', logs);
  return JSON.parse(
    await pyodide.runPythonAsync(`
import js
import json
from drain3 import TemplateMiner
from drain3.template_miner_config import TemplateMinerConfig
m = TemplateMiner(None, TemplateMinerConfig())
results = []
for log in HDXLOGS:
    results.append(m.add_log_message(log))

json.dumps(results)
    `),
  );
}

const PATTERN_COLUMN_ALIAS = '__hdx_pattern_field';
const TIMESTAMP_COLUMN_ALIAS = '__hdx_timestamp';

const useMinePatterns = ({
  config,
  samples,
  bodyValueExpression,
}: {
  config: ChartConfigWithDateRange;
  samples: number;
  bodyValueExpression: string;
}) => {
  const configWithPrimaryAndPartitionKey = useConfigWithPrimaryAndPartitionKey({
    ...config,
    // TODO: User-configurable pattern columns and non-pattern/group by columns
    select: [
      `${bodyValueExpression} as ${PATTERN_COLUMN_ALIAS}`,
      `${config.timestampValueExpression} as ${TIMESTAMP_COLUMN_ALIAS}`,
    ].join(','),
    // TODO: Proper sampling
    orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
    limit: { limit: samples },
  });

  const { data: sampleRows } = useQueriedChartConfig(
    configWithPrimaryAndPartitionKey ?? config, // `config` satisfying type, never used due to `enabled` check
    { enabled: configWithPrimaryAndPartitionKey != null },
  );

  const { data: pyodide } = usePyodide();

  return useQuery({
    queryKey: ['patterns', config],
    queryFn: () => {
      if (configWithPrimaryAndPartitionKey == null) {
        throw new Error('Unexpected configWithPrimaryAndPartitionKey is null');
      }

      const logs =
        sampleRows?.data.map(row => {
          return stripAnsi(row[PATTERN_COLUMN_ALIAS] as string);
        }) ?? [];

      // patternId -> count, {bucket:count}, pattern
      return mineEventPatterns(logs, pyodide).then(result => {
        const rowsWithPatternId = [];
        for (let i = 0; i < result.length; i++) {
          const r = result[i];
          const row = sampleRows?.data[i];
          rowsWithPatternId.push({
            ...row,
            __hdx_patternId: r.cluster_id,
            __hdx_pattern: r.template_mined,
          });
        }

        return {
          ...sampleRows,
          data: rowsWithPatternId,
          additionalKeysLength:
            configWithPrimaryAndPartitionKey.additionalKeysLength,
        };
      });
    },
    refetchOnWindowFocus: false,
    enabled: sampleRows != null && pyodide != null,
  });
};

export default function PatternTable({
  config,
  totalCountConfig,
  totalCountQueryKeyPrefix,
  bodyValueExpression,
}: {
  config: ChartConfigWithDateRange;
  totalCountConfig: ChartConfigWithDateRange;
  bodyValueExpression: string;
  totalCountQueryKeyPrefix: string;
}) {
  const SAMPLES = 10000;
  const { data: results, isFetching } = useMinePatterns({
    config,
    samples: SAMPLES,
    bodyValueExpression,
  });
  const columnMap = useMemo(() => {
    return selectColumnMapWithoutAdditionalKeys(
      results?.meta,
      results?.additionalKeysLength,
    );
  }, [results]);
  const columns = useMemo(() => Array.from(columnMap.keys()), [columnMap]);

  const {
    totalCount,
    isLoading: isTotalCountLoading,
    isError: isTotalCountError,
  } = useSearchTotalCount(totalCountConfig, totalCountQueryKeyPrefix);

  const sampleMultiplier = useMemo(() => {
    return totalCount ? totalCount / SAMPLES : 1;
  }, [totalCount]);

  const granularity = convertDateRangeToGranularityString(config.dateRange, 24);
  const timeRangeBuckets = timeBucketByGranularity(
    config.dateRange[0],
    config.dateRange[1],
    granularity,
  );

  // TODO: Group by pattern and other select attributes
  const groupedResults = useMemo(() => {
    const patternGroups = results?.data.reduce<Record<string, any[]>>(
      (acc, row) => {
        const key = `${row.__hdx_patternId}`;
        acc[key] = acc[key] || [];
        acc[key].push(row);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    const fullPatternGroups: Record<string, any> = {};
    // bucket count by timestamp
    Object.entries(patternGroups ?? {}).forEach(([patternId, rows]) => {
      const initBucketCount: Record<string, number> = timeRangeBuckets.reduce(
        (acc, bucket) => {
          acc[bucket.getTime()] = 0;
          return acc;
        },
        {} as Record<string, number>,
      );

      const bucketCounts = rows.reduce<Record<string, number>>((acc, row) => {
        const ts = row[TIMESTAMP_COLUMN_ALIAS];
        const bucket = toStartOfInterval(new Date(ts), granularity).getTime();
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
      }, initBucketCount);

      // return at least 1
      const count = Math.max(Math.round(rows.length * sampleMultiplier), 1);
      fullPatternGroups[patternId] = {
        id: patternId,
        pattern: rows[rows.length - 1].__hdx_pattern, // last pattern is usually the most up to date templated pattern
        count,
        countStr: `~${count}`,
        samples: rows,
        __hdx_pattern_trend: {
          data: Object.entries(bucketCounts).map(([bucket, count]) => ({
            bucket: Number.parseInt(bucket) / 1000, // recharts expects unix timestamp
            count: Math.round(count * sampleMultiplier),
          })),
          granularity,
          dateRange: config.dateRange,
        },
      };
    });

    return fullPatternGroups;
  }, [
    results,
    granularity,
    sampleMultiplier,
    timeRangeBuckets,
    config.dateRange,
  ]);

  const sortedGroupedResults = useMemo(() => {
    return Object.values(groupedResults).sort((a, b) => b.count - a.count);
  }, [groupedResults]);

  // TODO: Add side panel support for example logs
  return (
    <RawLogTable
      isLive={false}
      wrapLines={true}
      isLoading={isFetching}
      rows={sortedGroupedResults ?? []}
      displayedColumns={['__hdx_pattern_trend', 'countStr', 'pattern']}
      onRowExpandClick={() => {}}
      onSettingsClick={() => {}}
      onInstructionsClick={() => {}}
      hasNextPage={false}
      fetchNextPage={() => {}}
      highlightedLineId={''}
      columnTypeMap={columnMap}
      generateRowId={row => row.__hdx_patternId}
      columnNameMap={{
        __hdx_pattern_trend: 'Trend',
        countStr: 'Count',
        pattern: 'Pattern',
      }}
    />
  );
}
