import objectHash from 'object-hash';
import {
  ChSql,
  chSql,
  parameterizedQueryToSql,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithOptDateRange,
  FIXED_TIME_BUCKET_EXPR_ALIAS,
  isNonEmptyWhereExpr,
  isUsingGroupBy,
  renderChartConfig,
} from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  AggregateFunction,
  DerivedColumn,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';

import { getMetadata } from '@/metadata';

const HDX_DATABASE = 'hyperdx'; // all materialized views should sit in this database

// a hashed select field used as a field name in the materialized view
// TODO: normalize it using sql parser?
const getUniqSelectFieldName = (select: DerivedColumn) =>
  objectHash.sha1(select);

const getAggFn = (
  select: DerivedColumn,
): {
  fieldName: string;
  fn: AggregateFunction | `${AggregateFunction}If`;
  args: string[];
} => {
  const fieldName = getUniqSelectFieldName(select);
  const isWhereUsed = isNonEmptyWhereExpr(select.aggCondition);
  switch (select.aggFn) {
    case 'min':
    case 'max':
    case 'sum':
    case 'avg':
      return {
        fieldName,
        fn: `${select.aggFn}${isWhereUsed ? 'If' : ''}`,
        args: ['Nullable(Float64)', ...(isWhereUsed ? ['UInt8'] : [])],
      };
    case 'count':
      return {
        fieldName,
        fn: `${select.aggFn}${isWhereUsed ? 'If' : ''}`,
        args: isWhereUsed ? ['UInt8'] : [],
      };
    default:
      throw new Error(`Unsupported aggregation function: ${select.aggFn}`);
  }
};

const buildMTViewDataTableDDL = (
  table: string,
  chartConfig: ChartConfigWithOptDateRange,
) => {
  if (!Array.isArray(chartConfig.select)) {
    throw new Error('Only array select is supported');
  }

  // TODO: Support group by
  const isIncludingGroupBy = isUsingGroupBy(chartConfig);
  if (isIncludingGroupBy) {
    throw new Error('Group by is not supported');
  }

  return chSql`CREATE TABLE IF NOT EXISTS ${HDX_DATABASE}.${{ Identifier: table }}
      (
        ${{ Identifier: FIXED_TIME_BUCKET_EXPR_ALIAS }} DateTime,
        ${chartConfig.select
          .map(select => {
            const { args, fieldName, fn } = getAggFn(select);

            const aggFnArgs = [fn, ...args].join(',');

            return `${fieldName} AggregateFunction(${aggFnArgs})`;
          })
          .join(',\n')}
      )
      ENGINE = AggregatingMergeTree
      ORDER BY ${{ Identifier: FIXED_TIME_BUCKET_EXPR_ALIAS }}
      SETTINGS index_granularity = 8192
      `;
};

const buildMTViewDDL = (name: string, table: string, query: ChSql) => {
  return chSql`CREATE MATERIALIZED VIEW IF NOT EXISTS ${HDX_DATABASE}.${{ Identifier: name }} TO ${HDX_DATABASE}.${{ Identifier: table }} AS
      ${query}
    `;
};

export const buildMTViewSelectQuery = async (
  chartConfig: ChartConfigWithOptDateRange,
  customGranularity?: SQLInterval,
) => {
  const _config = {
    ...chartConfig,
    ...(Array.isArray(chartConfig.select) && {
      select: chartConfig.select.map(select => {
        const { fieldName, fn } = getAggFn(select);
        return {
          ...select,
          aggFn: `${fn}State`,
          alias: fieldName,
        };
      }) as DerivedColumn[],
    }),
    granularity: customGranularity ?? chartConfig.granularity,
    dateRange: undefined,
    orderBy: undefined,
    limit: undefined,
  };
  const mtViewSQL = await renderChartConfig(_config, getMetadata());
  const mtViewSQLHash = objectHash.sha1(mtViewSQL);
  const mtViewName = `${chartConfig.from.tableName}_mv_${mtViewSQLHash}`;
  const renderMTViewConfig = {
    ...chartConfig,
    ...(Array.isArray(chartConfig.select) && {
      select: chartConfig.select.map(select => {
        const { fieldName, fn } = getAggFn(select);
        return {
          aggFn: `${fn}Merge`,
          valueExpression: fieldName,
          alias: `${select.aggFn}(${select.valueExpression})`, // FIXME: format this properly
        };
      }) as DerivedColumn[],
    }),
    timestampValueExpression: FIXED_TIME_BUCKET_EXPR_ALIAS,
    from: {
      databaseName: HDX_DATABASE,
      tableName: mtViewName,
    },
  };

  return {
    mtViewName,
    dataTableDDL: parameterizedQueryToSql(
      buildMTViewDataTableDDL(`${mtViewName}_data`, chartConfig),
    ),
    mtViewDDL: parameterizedQueryToSql(
      buildMTViewDDL(mtViewName, `${mtViewName}_data`, mtViewSQL),
    ),
    renderMTViewConfig: async () => {
      try {
        return await renderChartConfig(renderMTViewConfig, getMetadata());
      } catch (e) {
        console.error('Failed to render MTView config', e);
        return null;
      }
    },
  };
};
