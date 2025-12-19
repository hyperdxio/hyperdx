import {
  extractColumnReferencesFromKey,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
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

/**
 * Given a table that is either a materialized view or a table targeted by a materialized view,
 * fetches the metadata for both the materialized view and the target table.
 *
 * Returns undefined if there are multiple materialized views targeting the given table,
 * or if the target table is not an AggregatingMergeTree.
 */
async function getMetadataForMaterializedViewAndTable({
  databaseName,
  tableName,
  connectionId,
}: TableConnection) {
  try {
    const metadata = getMetadata();
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

        return isAggregatingMergeTree(mvTableMetadata)
          ? { mvMetadata, mvTableMetadata }
          : undefined;
      }
    } else if (isAggregatingMergeTree(givenMetadata)) {
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
        /INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)\)/i,
      );
      const granularity = intervalMatch
        ? `${intervalMatch[1]} ${intervalMatch[2].toLowerCase()}`
        : '';
      if (
        granularity &&
        Object.values(intervalToGranularityMap).includes(granularity)
      ) {
        return granularity;
      }
    }
  } catch (e) {
    console.error('Error inferring timestamp column granularity', e);
  }
}

/**
 * Attempts to a MaterializedViewConfiguration object from the given TableConnections
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
): Promise<MaterializedViewConfiguration | undefined> {
  const { databaseName, tableName, connectionId } = mvTableOrView;
  const { databaseName: sourceDatabaseName, tableName: sourceTableName } =
    sourceTable;

  if (!tableName) {
    return undefined;
  }

  const meta = await getMetadataForMaterializedViewAndTable({
    databaseName,
    tableName,
    connectionId,
  });

  if (!meta) {
    return undefined;
  }

  const { mvMetadata, mvTableMetadata } = meta;
  const metadata = getMetadata();

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

  const sourceTableColumnNames = new Set(
    sourceTableColumns.map(col => col.name),
  );

  const aggregatedColumns: MaterializedViewConfiguration['aggregatedColumns'] =
    mvTableColumns
      .filter(col => col.type.includes('AggregateFunction'))
      .map(col => {
        let aggFn: string | undefined = col.type.match(
          /AggregateFunction\(([a-zA-Z0-9_]+)/,
        )?.[1];
        if (aggFn === 'sum' && col.name.toLowerCase().includes('count')) {
          aggFn = 'count';
        } else if (aggFn?.startsWith('quantile')) {
          aggFn = 'quantile';
        }

        if (!isAggregateFn(aggFn)) {
          return undefined;
        }

        // Convention: MV Columns are named "<aggFn>__<sourceColumn>"
        const nameSuffix = col.name.split('__')[1];
        const sourceColumn =
          sourceTableColumnNames.has(nameSuffix) && aggFn !== 'count'
            ? nameSuffix
            : '';

        return {
          mvColumn: col.name,
          aggFn,
          sourceColumn,
        };
      })
      .filter(c => c != undefined);

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
