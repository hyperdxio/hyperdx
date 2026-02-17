import { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { timeBucketByGranularity, toStartOfInterval } from '@/ChartUtils';
import {
  selectColumnMapWithoutAdditionalKeys,
  useConfigWithPrimaryAndPartitionKey,
} from '@/components/DBRowTable';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getFirstTimestampValueExpression } from '@/source';

// We don't want to load pyodide over and over again, use react query to cache the async instance
function usePyodide(options: { enabled: boolean }) {
  return useQuery({
    queryKey: ['pyodide'],
    queryFn: async () => {
      // @ts-ignore
      const pyodide = await window.loadPyodide();
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');

      // Install jsonpickle first (drain3 dependency)
      const jsonpickleUrl = new URL(
        '/jsonpickle-4.1.1-py3-none-any.whl',
        window.location.origin,
      );
      await micropip.install(jsonpickleUrl.href);

      // Then install drain3
      const drain3Url = new URL(
        '/drain3-0.9.11-py3-none-any.whl',
        window.location.origin,
      );
      await micropip.install(drain3Url.href);

      return pyodide;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
    enabled: options.enabled,
  });
}

class Miner {
  private minerVariableName;
  private id;
  constructor(private pyodide: any) {
    this.id = Math.random().toString(36).substring(2, 15);
    this.minerVariableName = `m_${this.id}`;
  }

  async init() {
    await this.pyodide.runPythonAsync(`
import js
import json
from drain3 import TemplateMiner
from drain3.template_miner_config import TemplateMinerConfig

${this.minerVariableName} = TemplateMiner(None, TemplateMinerConfig())
    `);
  }

  async minePatterns(logs: string[]) {
    const tempLogs = `temp_logs_${this.id}`;
    const tempResults = `temp_results_${this.id}`;
    this.pyodide.globals.set(tempLogs, logs);
    return JSON.parse(
      await this.pyodide.runPythonAsync(`
      ${tempResults} = []
      for log in ${tempLogs}:
        ${tempResults}.append(${this.minerVariableName}.add_log_message(log))
      json.dumps(${tempResults})
    `),
    );
  }

  async matchLogs(logs: string[]) {
    const tempLogs = `temp_logs_${this.id}`;
    const tempResults = `temp_results_${this.id}`;
    this.pyodide.globals.set(tempLogs, logs);

    return JSON.parse(
      await this.pyodide.runPythonAsync(`
      ${tempResults} = []
      for log in ${tempLogs}:
        match = ${this.minerVariableName}.match(log)
        ${tempResults}.append(match.cluster_id if match else None)
      json.dumps(${tempResults})
    `),
    );
  }
}

async function mineEventPatterns(logs: string[], pyodide: any) {
  const miner = new Miner(pyodide);
  await miner.init();
  return {
    miner,
    patterns: await miner.minePatterns(logs),
  };
}

export const PATTERN_COLUMN_ALIAS = '__hdx_pattern_field';
export const TIMESTAMP_COLUMN_ALIAS = '__hdx_timestamp';
export const SEVERITY_TEXT_COLUMN_ALIAS = '__hdx_severity_text';
export const STATUS_CODE_COLUMN_ALIAS = '__hdx_status_code';

export type SampleLog = {
  [PATTERN_COLUMN_ALIAS]: string;
  [TIMESTAMP_COLUMN_ALIAS]: string;
  [key: string]: any;
};

export type Pattern = {
  id: string;
  pattern: string;
  count: number;
  samples: SampleLog[];
};

function usePatterns({
  config,
  samples,
  bodyValueExpression,
  severityTextExpression,
  statusCodeExpression,
  enabled = true,
}: {
  config: ChartConfigWithDateRange;
  samples: number;
  bodyValueExpression: string;
  severityTextExpression?: string;
  statusCodeExpression?: string;
  enabled?: boolean;
}) {
  const configWithPrimaryAndPartitionKey = useConfigWithPrimaryAndPartitionKey({
    ...config,
    // TODO: User-configurable pattern columns and non-pattern/group by columns
    select: [
      `${bodyValueExpression} as ${PATTERN_COLUMN_ALIAS}`,
      `${getFirstTimestampValueExpression(config.timestampValueExpression)} as ${TIMESTAMP_COLUMN_ALIAS}`,
      ...(severityTextExpression
        ? [`${severityTextExpression} as ${SEVERITY_TEXT_COLUMN_ALIAS}`]
        : []),
      ...(statusCodeExpression
        ? [`${statusCodeExpression} as ${STATUS_CODE_COLUMN_ALIAS}`]
        : []),
    ].join(','),
    // TODO: Proper sampling
    orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
    limit: { limit: samples },
  });

  const { data: sampleRows, isLoading: isSampleLoading } =
    useQueriedChartConfig(
      configWithPrimaryAndPartitionKey ?? config, // `config` satisfying type, never used due to `enabled` check
      { enabled: configWithPrimaryAndPartitionKey != null && enabled },
    );

  const { data: pyodide, isLoading: isLoadingPyodide } = usePyodide({
    enabled,
  });

  const query = useQuery({
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
      return mineEventPatterns(logs, pyodide).then(response => {
        const rowsWithPatternId = [];
        const result = response.patterns;
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
          miner: response.miner,
        };
      });
    },
    refetchOnWindowFocus: false,
    enabled: sampleRows != null && pyodide != null && enabled,
  });

  return {
    ...query,
    isLoading: query.isLoading || isSampleLoading || isLoadingPyodide,
    patternQueryConfig: configWithPrimaryAndPartitionKey,
  };
}

export function useGroupedPatterns({
  config,
  samples,
  bodyValueExpression,
  severityTextExpression,
  statusCodeExpression,
  totalCount,
  enabled = true,
}: {
  config: ChartConfigWithDateRange;
  samples: number;
  bodyValueExpression: string;
  severityTextExpression?: string;
  statusCodeExpression?: string;
  totalCount?: number;
  enabled?: boolean;
}) {
  const {
    data: results,
    isLoading,
    patternQueryConfig,
  } = usePatterns({
    config,
    samples,
    bodyValueExpression,
    severityTextExpression,
    statusCodeExpression,
    enabled,
  });

  const sampledRowCount = results?.data.length;
  const sampleMultiplier = useMemo(() => {
    return totalCount && sampledRowCount ? totalCount / sampledRowCount : 1;
  }, [totalCount, sampledRowCount]);

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
      const lastRow = rows.at(-1);

      fullPatternGroups[patternId] = {
        id: patternId,
        pattern: lastRow?.__hdx_pattern, // last pattern is usually the most up to date templated pattern
        count,
        countStr: `~${count}`,
        severityText: lastRow?.[SEVERITY_TEXT_COLUMN_ALIAS], // last severitytext is usually representative of the entire pattern set
        statusCode: lastRow?.[STATUS_CODE_COLUMN_ALIAS],
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

  return {
    data: groupedResults,
    isLoading,
    miner: results?.miner,
    sampledRowCount,
    patternQueryConfig,
  };
}
