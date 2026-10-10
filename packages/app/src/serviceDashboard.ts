import { useMemo } from 'react';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import { useColumns, useJsonColumns } from './hooks/useMetadata';

const COALESCE_FIELDS_LIMIT = 100;

// Ordered from highest to lowest precedence
const DB_STATEMENT_KEYS = ['db.query.text', 'db.statement'];

/**
 * Where a skip index can be made to match a database statement. The OTel
 * schemas index span attributes two ways depending on the ClickHouse version:
 * newer ones an `<Name>AttributeItems` column of `key=value` strings, older
 * ones `mapValues(<Name>Attributes)`.
 */
type DbStatementIndexHint = {
  kind: 'items' | 'mapValues';
  column: string;
};

// Helper function to format field access based on column type
function formatFieldAccess(
  field: string,
  key: string,
  isJsonColumn: boolean,
): string {
  return isJsonColumn ? `${field}.\`${key}\`` : `${field}['${key}']`;
}

/**
 * Creates a 'coalesced' SQL query that checks whether each given field exists
 * and returns the first non-empty value.
 *
 * The list of fields should be ordered from highest precedence to lowest.
 *
 * @param fields list of fields (in order) to coalesce
 * @param isJSONColumn whether the fields are JSON columns
 * @returns a SQL query string that coalesces the fields
 */
export function makeCoalescedFieldsAccessQuery(
  fields: string[],
  isJSONColumn: boolean,
): string {
  if (fields.length === 0) {
    throw new Error(
      'Empty fields array passed while trying to build a coalesced field access query',
    );
  }

  if (fields.length > COALESCE_FIELDS_LIMIT) {
    throw new Error(
      `Too many fields (${fields.length}) passed while trying to build a coalesced field access query. Maximum allowed is ${COALESCE_FIELDS_LIMIT}`,
    );
  }

  if (fields.length === 1) {
    if (isJSONColumn) {
      return `if(toString(${fields[0]}) != '', toString(${fields[0]}), '')`;
    } else {
      return `nullif(${fields[0]}, '')`;
    }
  }

  if (isJSONColumn) {
    // For JSON columns, build nested if statements
    let query = '';
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const isLast = i === fields.length - 1;

      query += `if(
toString(${field}) != '',
toString(${field}),`;

      if (isLast) {
        query += `''\n`;
      } else {
        query += '\n';
      }
    }

    // Close all the if statements
    for (let i = 0; i < fields.length; i++) {
      query += ')';
    }

    return `coalesce(\n${query}\n)`;
  } else {
    // For non-JSON columns, use nullif with coalesce
    const nullifExpressions = fields.map(field => `nullif(${field}, '')`);
    return `coalesce(${nullifExpressions.join(', ')})`;
  }
}

function getDefaults({
  spanAttributeField = 'SpanAttributes',
  isAttributeFieldJSON = false,
}: {
  spanAttributeField?: string;
  isAttributeFieldJSON?: boolean;
} = {}) {
  const dbStatement = makeCoalescedFieldsAccessQuery(
    DB_STATEMENT_KEYS.map(key =>
      formatFieldAccess(spanAttributeField, key, isAttributeFieldJSON),
    ),
    isAttributeFieldJSON,
  );

  return {
    duration: 'Duration',
    durationPrecision: 9,
    traceId: 'TraceId',
    service: 'ServiceName',
    spanName: 'SpanName',
    spanKind: 'SpanKind',
    severityText: 'StatusCode',
    k8sResourceName: formatFieldAccess(
      spanAttributeField,
      'k8s.resource.name',
      isAttributeFieldJSON,
    ),
    k8sPodName: formatFieldAccess(
      spanAttributeField,
      'k8s.pod.name',
      isAttributeFieldJSON,
    ),
    serverAddress: formatFieldAccess(
      spanAttributeField,
      'server.address',
      isAttributeFieldJSON,
    ),
    httpHost: formatFieldAccess(
      spanAttributeField,
      'http.host',
      isAttributeFieldJSON,
    ),
    dbStatement,
  };
}

const ENDPOINT_MATERIALIZED_COLUMN_NAME = 'endpoint';

function getAttributeItemsColumn(
  attributesField: string,
  columns: ColumnMeta[],
): string | undefined {
  const itemsColumn = attributesField.replace(/Attributes$/, 'AttributeItems');
  const exists =
    itemsColumn !== attributesField &&
    columns.some(column => column.name === itemsColumn);
  return exists ? itemsColumn : undefined;
}

function getDbStatementIndexHint(
  attributesField: string,
  isAttributeFieldJSON: boolean,
  columns: ColumnMeta[],
): DbStatementIndexHint | undefined {
  if (isAttributeFieldJSON) {
    return undefined;
  }

  const itemsColumn = getAttributeItemsColumn(attributesField, columns);
  if (itemsColumn) {
    return { kind: 'items', column: itemsColumn };
  }

  const isMap = columns.some(
    column =>
      column.name === attributesField && column.type.startsWith('Map('),
  );
  return isMap ? { kind: 'mapValues', column: attributesField } : undefined;
}

function makeIndexPrefilter(
  hint: DbStatementIndexHint,
  statement: string,
): string {
  if (hint.kind === 'mapValues') {
    return `has(mapValues(${hint.column}), '${escapeSqlString(statement)}')`;
  }
  return DB_STATEMENT_KEYS.map(
    key =>
      `has(${hint.column}, '${escapeSqlString(`${key}=${statement}`)}')`,
  ).join(' OR ');
}

/**
 * Condition selecting the spans of a single database statement.
 *
 * No skip index covers the coalesced attribute lookup, so on its own it makes
 * ClickHouse read every granule in the time range. The prefilter matches a
 * superset of those spans in a form an index does cover; the coalesced
 * comparison still decides the match, so results are unchanged. It is also
 * cheaper where no index applies, since it short-circuits the coalesce.
 */
export function makeDbStatementCondition({
  expressions,
  statement,
}: {
  expressions: Pick<
    ReturnType<typeof getExpressions>,
    'dbStatement' | 'dbStatementIndexHint'
  >;
  statement: string;
}): string {
  const equality = `${expressions.dbStatement} IN ('${escapeSqlString(statement)}')`;
  const hint = expressions.dbStatementIndexHint;
  return hint
    ? `(${makeIndexPrefilter(hint, statement)}) AND ${equality}`
    : equality;
}

export function getExpressions(
  source: TTraceSource,
  columns: ColumnMeta[],
  jsonColumns: string[],
) {
  const spanAttributeField =
    source?.eventAttributesExpression || 'SpanAttributes';
  const isAttributeFieldJSON = jsonColumns.includes(spanAttributeField);
  const defaults = getDefaults({ spanAttributeField, isAttributeFieldJSON });

  const hasMaterializedEndpointColumn = !!columns.find(
    col => col.name === ENDPOINT_MATERIALIZED_COLUMN_NAME,
  );

  const fieldExpressions = {
    // General
    duration: source.durationExpression || defaults.duration,
    durationPrecision: source.durationPrecision || defaults.durationPrecision,
    traceId: source.traceIdExpression || defaults.traceId,
    service: source.serviceNameExpression || defaults.service,
    spanName: source.spanNameExpression || defaults.spanName,
    spanKind: source.spanKindExpression || defaults.spanKind,
    severityText: source.statusCodeExpression || defaults.severityText,

    // HTTP
    httpHost: defaults.httpHost,
    serverAddress: defaults.serverAddress,

    // Kubernetes
    k8sResourceName: defaults.k8sResourceName,
    k8sPodName: defaults.k8sPodName,

    // Database
    dbStatement: defaults.dbStatement,
    dbStatementIndexHint: getDbStatementIndexHint(
      spanAttributeField,
      isAttributeFieldJSON,
      columns,
    ),
  };

  const auxExpressions = {
    endpoint: hasMaterializedEndpointColumn
      ? ENDPOINT_MATERIALIZED_COLUMN_NAME
      : fieldExpressions.spanName,
    /** An expression for reading the Span duration in milliseconds. Using this will prevent the use of aggregating materialized views which aggregate `Duration` instead of `Duration/1e6` */
    durationInMillis: `${fieldExpressions.duration}/1e${fieldExpressions.durationPrecision - 3}`,
    /** The divisor used to convert the Span duration to milliseconds */
    durationDivisorForMillis: `1e${fieldExpressions.durationPrecision - 3}`,
  };

  const filterExpressions = {
    isEndpointNonEmpty: `NOT empty(${auxExpressions.endpoint})`,
    isError: `lower(${fieldExpressions.severityText}) = 'error'`,
    isSpanKindServer: `${fieldExpressions.spanKind} IN ('Server', 'SPAN_KIND_SERVER')`,
    isDbSpan: `${fieldExpressions.dbStatement} <> ''`,
  };

  return {
    ...fieldExpressions,
    ...filterExpressions,
    ...auxExpressions,
  };
}

export function useServiceDashboardExpressions({
  source,
}: {
  source: TTraceSource | undefined;
}) {
  const tableConnection = useMemo(() => tcFromSource(source), [source]);

  const { data: jsonColumns, isLoading: isJsonColumnsLoading } =
    useJsonColumns(tableConnection);
  const { data: columns = [], isLoading: isColumnsLoading } =
    useColumns(tableConnection);

  const isLoading = !source || isJsonColumnsLoading || isColumnsLoading;

  const expressions = useMemo(() => {
    if (isLoading || !jsonColumns || !columns) return undefined;
    if (source?.kind !== SourceKind.Trace) return undefined;

    return getExpressions(source, columns, jsonColumns);
  }, [source, columns, jsonColumns, isLoading]);

  return {
    expressions,
    isLoading,
  };
}
