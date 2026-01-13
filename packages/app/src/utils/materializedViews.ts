import {
  ColumnMeta,
  extractColumnReferencesFromKey,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Metadata,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  Granularity,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  InternalAggregateFunction,
  MaterializedViewConfiguration,
} from '@hyperdx/common-utils/dist/types';

import { getMetadata } from '@/metadata';

export const MV_AGGREGATE_FUNCTIONS = [
  'avg',
  'count',
  'max',
  'min',
  'quantile',
  'sum',
  'histogram',
];

/**
 * To maximize the number of queries which are compatible with materialized views,
 * every granularity should be a multiple of every smaller granularity.
 *
 * Further, these should match the granularities supported by charts, defined
 * in convertDateRangeToGranularityString().
 * */
export const MV_GRANULARITY_OPTIONS = [
  { value: '1 second', label: '1 second' },
  { value: Granularity.FifteenSecond, label: '15 seconds' },
  { value: Granularity.ThirtySecond, label: '30 seconds' },
  { value: Granularity.OneMinute, label: '1 minute' },
  { value: Granularity.FiveMinute, label: '5 minutes' },
  { value: Granularity.FifteenMinute, label: '15 minutes' },
  { value: Granularity.ThirtyMinute, label: '30 minutes' },
  { value: Granularity.OneHour, label: '1 hour' },
  { value: Granularity.TwoHour, label: '2 hours' },
  { value: Granularity.SixHour, label: '6 hours' },
  { value: Granularity.TwelveHour, label: '12 hours' },
  { value: Granularity.OneDay, label: '1 day' },
  { value: Granularity.TwoDay, label: '2 days' },
  { value: Granularity.SevenDay, label: '7 days' },
  { value: Granularity.ThirtyDay, label: '30 days' },
];

const isGranularity = (value: string): value is Granularity => {
  return MV_GRANULARITY_OPTIONS.map(option => option.value as string).includes(
    value,
  );
};

const MV_DDL_PATTERN = /MATERIALIZED VIEW [^\s]+\.[^\s]+ TO ([^\s]+)\.([^\s]+)/;
function getViewTargetTable(meta: TableMetadata) {
  const match = meta.create_table_query.match(MV_DDL_PATTERN);
  if (match && match[1] && match[2]) {
    return {
      databaseName: match[1],
      tableName: match[2],
    };
  }
}

const isAggregateFn = (
  aggFn: string | undefined,
): aggFn is InternalAggregateFunction => {
  return MV_AGGREGATE_FUNCTIONS.includes(aggFn ?? '');
};

function isMaterializedView(meta: TableMetadata) {
  return meta.engine?.startsWith('MaterializedView') ?? false;
}

function isAggregatingMergeTree(meta: TableMetadata) {
  return meta.engine?.includes('AggregatingMergeTree') ?? false;
}

function isSummingMergeTree(meta: TableMetadata) {
  return meta.engine?.includes('SummingMergeTree') ?? false;
}

/**
 * Given a table that is either a materialized view or a table targeted by a materialized view,
 * fetches the metadata for both the materialized view and the target table.
 *
 * Returns undefined if there are multiple materialized views targeting the given table,
 * or if the target table is not an AggregatingMergeTree.
 */
async function getMetadataForMaterializedViewAndTable(
  { databaseName, tableName, connectionId }: TableConnection,
  metadata: Metadata,
) {
  try {
    const givenMetadata = await metadata.getTableMetadata({
      databaseName,
      tableName,
      connectionId,
    });

    if (isMaterializedView(givenMetadata)) {
      const mvMetadata = givenMetadata;
      const mvTableDetails = getViewTargetTable(mvMetadata);

      if (mvTableDetails) {
        const mvTableMetadata = await metadata.getTableMetadata({
          ...mvTableDetails,
          connectionId,
        });

        return isAggregatingMergeTree(mvTableMetadata) ||
          isSummingMergeTree(mvTableMetadata)
          ? { mvMetadata, mvTableMetadata }
          : undefined;
      }
    } else if (
      isAggregatingMergeTree(givenMetadata) ||
      isSummingMergeTree(givenMetadata)
    ) {
      const mvTableMetadata = givenMetadata;
      const sourceViews = await metadata.queryMaterializedViewsByTarget({
        databaseName,
        tableName,
        connectionId,
      });

      if (sourceViews.length === 1) {
        const mvMetadata = await metadata.getTableMetadata({
          ...sourceViews[0],
          connectionId,
        });

        return {
          mvMetadata,
          mvTableMetadata,
        };
      } else {
        // We can't be sure which materialized view to use, so
        // just return the target table metadata
        return { mvTableMetadata };
      }
    }
  } catch (e) {
    console.error('Error fetching materialized view metadata', e);
  }
}

/**
 * Split the given materialized view's SELECT expression into individual column expressions.
 */
function extractSelectExpressions(meta: TableMetadata) {
  const selectStr = meta.as_select ?? '';

  // Remove the "SELECT" keyword and everything after "FROM"
  const selectExpressionWithoutSelect = selectStr
    .slice(0, selectStr.toLowerCase().indexOf('from'))
    .replace(/^select/i, '')
    .trim();

  // Split into individual expressions (eg. ['toStartOfMinute(Timestamp) AS Timestamp', ...])
  return splitAndTrimWithBracket(selectExpressionWithoutSelect);
}

/**
 * Returns the granularity of the given timestamp column, if it can be inferred
 * by looking for a toStartOf(Second|Minute|Hour|Day) function in the given list
 * of select column expressions.
 *
 * Returns undefined if the granularity cannot be inferred.
 **/
export function inferTimestampColumnGranularity(
  mvMetadata: TableMetadata,
  timestampColumn: string,
) {
  try {
    // Find any expression that uses toStartOfX on the timestamp column
    const selectExpressions = extractSelectExpressions(mvMetadata);
    const timestampExpression = selectExpressions.find(
      expr => expr.match(/toStartOf|toDate/) && expr.includes(timestampColumn),
    );

    if (!timestampExpression) {
      return undefined;
    }

    // Look for fixed interval functions
    const intervalToGranularityMap: Record<string, string> = {
      toStartOfSecond: '1 second',
      toStartOfMinute: '1 minute',
      toStartOfFiveMinutes: '5 minute',
      toStartOfFifteenMinutes: '15 minute',
      toStartOfHour: '1 hour',
      toStartOfDay: '1 day',
      toDate: '1 day',
      toDateTime: '1 second',
    };

    for (const [func, granularity] of Object.entries(
      intervalToGranularityMap,
    )) {
      if (timestampExpression?.includes(`${func}(`)) {
        return granularity;
      }
    }

    // Look for toStartOfInterval(Timestamp, INTERVAL X UNIT)
    // Only accept specific granularities matching the ones defined above
    if (timestampExpression.includes(`toStartOfInterval(`)) {
      const intervalMatch = timestampExpression.match(
        /INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)S?\)/i,
      );
      const intervalFunctionMatch = timestampExpression.match(
        /toInterval(Second|Minute|Hour|Day)\((\d+)\)/,
      );
      const granularity = intervalMatch
        ? `${intervalMatch[1]} ${intervalMatch[2].toLowerCase()}`
        : intervalFunctionMatch
          ? `${intervalFunctionMatch[2]} ${intervalFunctionMatch[1].toLowerCase()}`
          : null;
      if (
        granularity &&
        isGranularity(granularity) &&
        MV_GRANULARITY_OPTIONS.map(option => option.value).includes(granularity)
      ) {
        return granularity;
      }
    }
  } catch (e) {
    console.error('Error inferring timestamp column granularity', e);
  }
}

/** Returns the set of columns that are summed in the given SummingMergeTree engine table. */
export function parseSummedColumns(mvTableMetadata: TableMetadata) {
  if (!isSummingMergeTree(mvTableMetadata)) {
    return undefined;
  }

  // Extract the column list from the engine parameters
  // SummingMergeTree(col1) or SummingMergeTree((col1, col2, ...))
  const engineParamStr = mvTableMetadata.engine_full?.match(
    /SummingMergeTree\((\(?[^(]*)\)/,
  )?.[1];

  // Remove surrounding parentheses if present
  const engineParamStripped =
    engineParamStr?.at(0) === '(' && engineParamStr?.at(-1) === ')'
      ? engineParamStr.slice(1, -1)
      : engineParamStr;

  if (engineParamStripped) {
    return new Set(splitAndTrimWithBracket(engineParamStripped));
  }
}

function escapeRegExp(s: string) {
  // $& means the whole matched string
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getSourceTableColumn(
  aggFn: string,
  targetTableColumn: ColumnMeta,
  sourceTableColumns: ColumnMeta[],
  mvMetadata?: TableMetadata,
) {
  if (aggFn === 'count') {
    // Count may not have a source column
    return '';
  }

  // By convention: MV Columns are named "<aggFn>__<sourceColumn>"
  const nameSuffix = targetTableColumn.name.split('__')[1];
  if (sourceTableColumns.find(col => col.name === nameSuffix)) {
    return nameSuffix;
  }

  // Try to infer from the MV's SELECT expression
  if (mvMetadata) {
    const selectExpressions = extractSelectExpressions(mvMetadata);
    const matchingSelectExpression = selectExpressions.find(expr =>
      // Use endsWith because the expression must have an alias
      // matching the target column name.
      expr.endsWith(targetTableColumn.name),
    );
    const matchingSourceColumn =
      matchingSelectExpression &&
      sourceTableColumns.find(col =>
        new RegExp(`\\b${escapeRegExp(col.name)}\\b`).test(
          matchingSelectExpression,
        ),
      );
    if (matchingSourceColumn) {
      return matchingSourceColumn.name;
    }
  }

  return '';
}

/**
 * Attempts to create a MaterializedViewConfiguration object from the given TableConnections
 * by introspecting the view, target table, and source table.
 *
 * @param mvTableOrView - A TableConnection representing either the materialized view or the target table.
 * @param sourceTable - A TableConnection representing the source table (the table the materialized view selects from).
 *
 * Returns undefined if the configuration cannot be inferred.
 */
export async function inferMaterializedViewConfig(
  mvTableOrView: TableConnection,
  sourceTable: TableConnection,
  metadata: Metadata,
): Promise<MaterializedViewConfiguration | undefined> {
  const { databaseName, tableName, connectionId } = mvTableOrView;
  const { databaseName: sourceDatabaseName, tableName: sourceTableName } =
    sourceTable;

  if (!tableName) {
    return undefined;
  }

  const meta = await getMetadataForMaterializedViewAndTable(
    {
      databaseName,
      tableName,
      connectionId,
    },
    metadata,
  );

  if (!meta) {
    return undefined;
  }

  const { mvMetadata, mvTableMetadata } = meta;

  const [mvTableColumns, sourceTableColumns] = await Promise.all([
    metadata.getColumns({
      databaseName: mvTableMetadata.database,
      tableName: mvTableMetadata.name,
      connectionId,
    }),
    metadata.getColumns({
      databaseName: sourceDatabaseName,
      tableName: sourceTableName,
      connectionId,
    }),
  ]);

  const aggregatedColumns: MaterializedViewConfiguration['aggregatedColumns'] =
    mvTableColumns
      .filter(targetTableColumn =>
        targetTableColumn.type.includes('AggregateFunction'),
      )
      .map(targetTableColumn => {
        let aggFn: string | undefined = targetTableColumn.type.match(
          /AggregateFunction\(([a-zA-Z0-9_]+)/,
        )?.[1];
        if (
          aggFn === 'sum' &&
          targetTableColumn.name.toLowerCase().includes('count')
        ) {
          aggFn = 'count';
        } else if (aggFn?.startsWith('quantile')) {
          aggFn = 'quantile';
        }

        if (!isAggregateFn(aggFn)) {
          return undefined;
        }

        const sourceColumn = getSourceTableColumn(
          aggFn,
          targetTableColumn,
          sourceTableColumns,
          mvMetadata,
        );

        return {
          mvColumn: targetTableColumn.name,
          aggFn,
          sourceColumn,
        };
      })
      .filter(c => c != undefined);

  // Add Aggregated columns from the SummingMergeTree engine, if applicable
  const summedColumnNames = isSummingMergeTree(mvTableMetadata)
    ? parseSummedColumns(mvTableMetadata)
    : undefined;
  for (const summedColumn of summedColumnNames ?? []) {
    const aggFn: InternalAggregateFunction = summedColumn
      .toLowerCase()
      .includes('count')
      ? 'count'
      : 'sum';

    const summedColumnMeta = mvTableColumns.find(
      col => col.name === summedColumn,
    );

    if (summedColumnMeta) {
      const sourceColumn = getSourceTableColumn(
        aggFn,
        summedColumnMeta,
        sourceTableColumns,
        mvMetadata,
      );
      aggregatedColumns.push({
        mvColumn: summedColumn,
        aggFn,
        sourceColumn,
      });
    }
  }

  // Infer the timestamp column
  const primaryKeyColumns = new Set(
    extractColumnReferencesFromKey(mvTableMetadata.primary_key),
  );
  const timestampColumns =
    filterColumnMetaByType(mvTableColumns, [JSDataType.Date]) ?? [];
  const timestampColumn =
    timestampColumns?.find(c => primaryKeyColumns.has(c.name))?.name ?? '';

  // Infer the granularity, if possible
  let minGranularity = '';
  if (mvMetadata) {
    minGranularity =
      inferTimestampColumnGranularity(mvMetadata, timestampColumn) ?? '';
  }

  // Infer the dimension columns
  const dimensionColumns = mvTableColumns
    .filter(
      col =>
        !col.type.includes('AggregateFunction') &&
        !summedColumnNames?.has(col.name) &&
        !timestampColumns.includes(col),
    )
    .map(col => col.name)
    .join(', ');

  return {
    databaseName: mvTableMetadata.database,
    tableName: mvTableMetadata.name,
    dimensionColumns,
    minGranularity,
    timestampColumn,
    aggregatedColumns,
  };
}
