import { TSource } from '@hyperdx/common-utils/dist/types';

function getDefaults(jsonColumns: string[] = []) {
  const spanAttributeField = 'SpanAttributes';
  const isJsonColumn = jsonColumns.includes(spanAttributeField);

  // Helper function to format field access based on column type
  const formatFieldAccess = (field: string, key: string) => {
    if (isJsonColumn) {
      return `${field}.\`${key}\``;
    } else {
      return `${field}['${key}']`;
    }
  };

  return {
    duration: 'Duration',
    durationPrecision: 9,
    traceId: 'TraceId',
    service: 'ServiceName',
    spanName: 'SpanName',
    spanKind: 'SpanKind',
    severityText: 'StatusCode',
    k8sResourceName: formatFieldAccess(spanAttributeField, 'k8s.resource.name'),
    k8sPodName: formatFieldAccess(spanAttributeField, 'k8s.pod.name'),
    httpScheme: formatFieldAccess(spanAttributeField, 'http.scheme'),
    serverAddress: formatFieldAccess(spanAttributeField, 'server.address'),
    httpHost: formatFieldAccess(spanAttributeField, 'http.host'),
    dbStatement: `coalesce(nullif(${formatFieldAccess(spanAttributeField, 'db.query.text')}, ''), nullif(${formatFieldAccess(spanAttributeField, 'db.statement')}, ''))`,
  };
}

export function getExpressions(source?: TSource, jsonColumns: string[] = []) {
  const defaults = getDefaults(jsonColumns);

  const fieldExpressions = {
    // General
    duration: source?.durationExpression || defaults.duration,
    durationPrecision: source?.durationPrecision || defaults.durationPrecision,
    traceId: source?.traceIdExpression || defaults.traceId,
    service: source?.serviceNameExpression || defaults.service,
    spanName: source?.spanNameExpression || defaults.spanName,
    spanKind: source?.spanKindExpression || defaults.spanKind,
    severityText: source?.severityTextExpression || defaults.severityText,

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
