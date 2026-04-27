import { clickhouse } from 'sql-formatter';
import { SQLConfig, SQLDialect } from '@codemirror/lang-sql';
import { sql } from '@codemirror/lang-sql';

const { tokenizerOptions } = clickhouse;

const allKeywords = [
  ...tokenizerOptions.reservedKeywords,
  ...tokenizerOptions.reservedClauses,
  ...tokenizerOptions.reservedSelect,
  ...tokenizerOptions.reservedSetOperations,
  ...tokenizerOptions.reservedJoins,
  ...(tokenizerOptions.reservedKeywordPhrases ?? []),
];

const clickhouseDialect = SQLDialect.define({
  keywords: allKeywords.join(' ').toLowerCase(),
  types: tokenizerOptions.reservedDataTypes.join(' ').toLowerCase(),
  builtin: tokenizerOptions.reservedFunctionNames.join(' ').toLowerCase(),
  backslashEscapes: true,
  doubleDollarQuotedStrings: true,
  operatorChars: '*+-%<>!=&|~^/?:',
  identifierQuotes: '`"',
});

export const clickhouseSql = (config?: SQLConfig) =>
  sql({ ...config, dialect: clickhouseDialect });
