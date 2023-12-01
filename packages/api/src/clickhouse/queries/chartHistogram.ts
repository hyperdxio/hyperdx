import { getLogStreamTableName, buildLogsPropertyTypeMappingsModel, buildTeamLogStreamWhereCondition, buildLogStreamAdditionalFilters } from "../index";
import {
    SQLSerializer,
    buildSearchColumnName,
    buildSearchQueryWhereCondition,
    isCustomColumn,
  } from '../searchQueryParser';
  import {client} from '../client';
import logger from '@/utils/logger';
import SqlString from 'sqlstring';

import type { ResponseJSON, ResultSet } from '@clickhouse/client';
import { LogsPropertyTypeMappingsModel } from "../propertyTypeMappingsModel";

// TODO: move this to PropertyTypeMappingsModel
const doesLogsPropertyExist = (
    property: string | undefined,
    model: LogsPropertyTypeMappingsModel,
  ) => {
    if (!property) {
      return true; // in this case, we don't refresh the property type mappings
    }
    return isCustomColumn(property) || model.get(property);
  };

export const getChartHistogram = async ({
    bins,
    endTime,
    field,
    q,
    startTime,
    tableVersion,
    teamId,
  }: {
    bins: number;
    endTime: number; // unix in ms,
    field: string;
    q: string;
    startTime: number; // unix in ms
    tableVersion: number | undefined;
    teamId: string;
  }) => {
    const tableName = getLogStreamTableName(tableVersion, teamId);
    const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
      tableVersion,
      teamId,
      startTime,
      endTime,
    );
    const whereClause = await buildSearchQueryWhereCondition({
      endTime,
      propertyTypeMappingsModel,
      query: q,
      startTime,
      teamId,
    });
  
    // TODO: hacky way to make sure the cache is update to date
    if (!doesLogsPropertyExist(field, propertyTypeMappingsModel)) {
      logger.warn({
        message: `getChart: Property type mappings cache is out of date (${field})`,
      });
      await propertyTypeMappingsModel.refresh();
    }
  
    // WARNING: selectField can be null
    const selectField = buildSearchColumnName(
      propertyTypeMappingsModel.get(field),
      field,
    );
  
    const serializer = new SQLSerializer(propertyTypeMappingsModel);
  
    const selectClause = `histogram(${bins})(${selectField}) as data`;
  
    const query = SqlString.format(`SELECT ? FROM ?? WHERE ? AND (?) AND (?)`, [
      SqlString.raw(selectClause),
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereClause),
      SqlString.raw(`${await serializer.isNotNull(field, false)}`),
    ]);
  
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
    logger.info({
      message: 'getChartHistogram',
      query,
      teamId,
      took: Date.now() - ts,
    });
    return result;
  };