import { TSource } from '@/commonTypes';

function getDefaults() {
  const spanAttributeField = 'SpanAttributes';

  return {
    duration: 'Duration',
    durationPrecision: 9,
    traceId: 'TraceId',
    service: 'ServiceName',
    spanName: 'SpanName',
    spanKind: 'SpanKind',
    severityText: 'StatusCode',
    k8sResourceName: `${spanAttributeField}['k8s.resource.name']`,
    k8sPodName: `${spanAttributeField}['k8s.pod.name']`,
    httpScheme: `${spanAttributeField}['http.scheme']`,
    serverAddress: `${spanAttributeField}['server.address']`,
    httpHost: `${spanAttributeField}['http.host']`,
    dbStatement: `coalesce(nullif(${spanAttributeField}['db.query.text'], ''), nullif(${spanAttributeField}['db.statement'], ''))`,
  };
}

export function getExpressions(source?: TSource) {
  const defaults = getDefaults();

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
