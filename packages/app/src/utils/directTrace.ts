import SqlString from 'sqlstring';

export function buildDirectTraceWhereClause(
  traceIdExpression: string | undefined,
  traceId: string,
): string {
  return `${traceIdExpression ?? 'TraceId'} = ${SqlString.escape(traceId)}`;
}

export function buildTraceRedirectUrl({
  traceId,
  search,
}: {
  traceId: string;
  search: string;
}): string {
  const params = new URLSearchParams(search);
  params.set('traceId', traceId);

  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

export function getDefaultDirectTraceDateRange(
  nowMs = performance.timeOrigin + performance.now(),
): [Date, Date] {
  // between 14 days ago and now
  return [new Date(nowMs - 14 * 24 * 60 * 60 * 1000), new Date(nowMs)];
}
