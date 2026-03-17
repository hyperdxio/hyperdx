import SqlString from 'sqlstring';

export function buildInFilterCondition(
  columnExpression: string,
  value: string,
): string {
  return SqlString.format('? IN (?)', [SqlString.raw(columnExpression), value]);
}
