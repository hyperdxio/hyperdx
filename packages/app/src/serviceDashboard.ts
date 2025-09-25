import { TTraceSource } from '@hyperdx/common-utils/dist/types';

const COALESCE_FIELDS_LIMIT = 100;

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
    [
      formatFieldAccess(
        spanAttributeField,
        'db.query.text',
        isAttributeFieldJSON,
      ),
      formatFieldAccess(
        spanAttributeField,
        'db.statement',
        isAttributeFieldJSON,
      ),
    ],
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
    httpScheme: formatFieldAccess(
      spanAttributeField,
      'http.scheme',
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

export function getExpressions(
  source?: TTraceSource,
  jsonColumns: string[] = [],
) {
  const spanAttributeField =
    source?.eventAttributesExpression || 'SpanAttributes';
  const isAttributeFieldJSON = jsonColumns.includes(spanAttributeField);
  const defaults = getDefaults({ spanAttributeField, isAttributeFieldJSON });

  const fieldExpressions = {
    // General
    duration:
      (source && 'durationExpression' in source && source.durationExpression) ||
      defaults.duration,
    durationPrecision: source?.durationPrecision || defaults.durationPrecision,
    traceId: source?.traceIdExpression || defaults.traceId,
    service: source?.serviceNameExpression || defaults.service,
    spanName: source?.spanNameExpression || defaults.spanName,
    spanKind: source?.spanKindExpression || defaults.spanKind,
    severityText: source?.statusCodeExpression || defaults.severityText,

    // HTTP
    httpScheme: defaults.httpScheme,
    httpHost: defaults.httpHost,
    serverAddress: defaults.serverAddress,

    // Kubernetes
    k8sResourceName: defaults.k8sResourceName,
    k8sPodName: defaults.k8sPodName,

    // Database
    dbStatement: defaults.dbStatement,
  };

  const filterExpressions = {
    isError: `lower(${fieldExpressions.severityText}) = 'error'`,
    isSpanKindServer: `${fieldExpressions.spanKind} IN ('Server', 'SPAN_KIND_SERVER')`,
    isDbSpan: `${fieldExpressions.dbStatement} <> ''`,
  };

  const auxExpressions = {
    durationInMillis: `${fieldExpressions.duration}/1e${fieldExpressions.durationPrecision - 3}`, // precision is per second
  };

  return {
    ...fieldExpressions,
    ...filterExpressions,
    ...auxExpressions,
  };
}
