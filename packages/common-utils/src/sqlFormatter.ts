// custom dialect ref: https://github.com/sql-formatter-org/sql-formatter/blob/master/docs/dialect.md#custom-dialect-configuration-experimental
// Dialect source: https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/sql/sql.formatter.ts
import { DialectOptions, expandPhrases, formatDialect } from 'sql-formatter';

// source : https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/sql/sql.functions.ts
export const functions: string[] = [
  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_9_set_function_specification
  'GROUPING',

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_10_window_function
  'RANK',
  'DENSE_RANK',
  'PERCENT_RANK',
  'CUME_DIST',
  'ROW_NUMBER',

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_27_numeric_value_function
  'POSITION',
  'OCCURRENCES_REGEX',
  'POSITION_REGEX',
  'EXTRACT',
  'CHAR_LENGTH',
  'CHARACTER_LENGTH',
  'OCTET_LENGTH',
  'CARDINALITY',
  'ABS',
  'MOD',
  'LN',
  'EXP',
  'POWER',
  'SQRT',
  'FLOOR',
  'CEIL',
  'CEILING',
  'WIDTH_BUCKET',

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_29_string_value_function
  'SUBSTRING',
  'SUBSTRING_REGEX',
  'UPPER',
  'LOWER',
  'CONVERT',
  'TRANSLATE',
  'TRANSLATE_REGEX',
  'TRIM',
  'OVERLAY',
  'NORMALIZE',
  'SPECIFICTYPE',

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_31_datetime_value_function
  'CURRENT_DATE',
  'CURRENT_TIME',
  'LOCALTIME',
  'CURRENT_TIMESTAMP',
  'LOCALTIMESTAMP',

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_38_multiset_value_function
  // SET serves multiple roles: a SET() function and a SET keyword e.g. in UPDATE table SET ...
  // multiset
  // 'SET', (disabled for now)

  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_10_9_aggregate_function
  'COUNT',
  'AVG',
  'MAX',
  'MIN',
  'SUM',
  // 'EVERY',
  // 'ANY',
  // 'SOME',
  'STDDEV_POP',
  'STDDEV_SAMP',
  'VAR_SAMP',
  'VAR_POP',
  'COLLECT',
  'FUSION',
  'INTERSECTION',
  'COVAR_POP',
  'COVAR_SAMP',
  'CORR',
  'REGR_SLOPE',
  'REGR_INTERCEPT',
  'REGR_COUNT',
  'REGR_R2',
  'REGR_AVGX',
  'REGR_AVGY',
  'REGR_SXX',
  'REGR_SYY',
  'REGR_SXY',
  'PERCENTILE_CONT',
  'PERCENTILE_DISC',

  // CAST is a pretty complex case, involving multiple forms:
  // - CAST(col AS int)
  // - CAST(...) WITH ...
  // - CAST FROM int
  // - CREATE CAST(mycol AS int) WITH ...
  'CAST',

  // Shorthand functions to use in place of CASE expression
  'COALESCE',
  'NULLIF',

  // Non-standard functions that have widespread support
  'ROUND',
  'SIN',
  'COS',
  'TAN',
  'ASIN',
  'ACOS',
  'ATAN',
];

// source: https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/sql/sql.keywords.ts
export const keywords: string[] = [
  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#reserved-word
  'ALL',
  'ALLOCATE',
  'ALTER',
  'ANY', // <- moved over from functions
  'ARE',
  'AS',
  'ASC', // Not reserved in SQL-2008, but commonly reserved in most dialects
  'ASENSITIVE',
  'ASYMMETRIC',
  'AT',
  'ATOMIC',
  'AUTHORIZATION',
  'BEGIN',
  'BETWEEN',
  'BOTH',
  'BY',
  'CALL',
  'CALLED',
  'CASCADED',
  'CAST',
  'CHECK',
  'CLOSE',
  'COALESCE',
  'COLLATE',
  'COLUMN',
  'COMMIT',
  'CONDITION',
  'CONNECT',
  'CONSTRAINT',
  'CORRESPONDING',
  'CREATE',
  'CROSS',
  'CUBE',
  'CURRENT',
  'CURRENT_CATALOG',
  'CURRENT_DEFAULT_TRANSFORM_GROUP',
  'CURRENT_PATH',
  'CURRENT_ROLE',
  'CURRENT_SCHEMA',
  'CURRENT_TRANSFORM_GROUP_FOR_TYPE',
  'CURRENT_USER',
  'CURSOR',
  'CYCLE',
  'DEALLOCATE',
  'DAY',
  'DECLARE',
  'DEFAULT',
  'DELETE',
  'DEREF',
  'DESC', // Not reserved in SQL-2008, but commonly reserved in most dialects
  'DESCRIBE',
  'DETERMINISTIC',
  'DISCONNECT',
  'DISTINCT',
  'DROP',
  'DYNAMIC',
  'EACH',
  'ELEMENT',
  'END-EXEC',
  'ESCAPE',
  'EVERY', // <- moved over from functions
  'EXCEPT',
  'EXEC',
  'EXECUTE',
  'EXISTS',
  'EXTERNAL',
  'FALSE',
  'FETCH',
  'FILTER',
  'FOR',
  'FOREIGN',
  'FREE',
  'FROM',
  'FULL',
  'FUNCTION',
  'GET',
  'GLOBAL',
  'GRANT',
  'GROUP',
  'HAVING',
  'HOLD',
  'HOUR',
  'IDENTITY',
  'IN',
  'INDICATOR',
  'INNER',
  'INOUT',
  'INSENSITIVE',
  'INSERT',
  'INTERSECT',
  'INTO',
  'IS',
  'LANGUAGE',
  'LARGE',
  'LATERAL',
  'LEADING',
  'LEFT',
  'LIKE',
  'LIKE_REGEX',
  'LOCAL',
  'MATCH',
  'MEMBER',
  'MERGE',
  'METHOD',
  'MINUTE',
  'MODIFIES',
  'MODULE',
  'MONTH',
  'NATURAL',
  'NEW',
  'NO',
  'NONE',
  'NOT',
  'NULL',
  'NULLIF',
  'OF',
  'OLD',
  'ON',
  'ONLY',
  'OPEN',
  'ORDER',
  'OUT',
  'OUTER',
  'OVER',
  'OVERLAPS',
  'PARAMETER',
  'PARTITION',
  'PRECISION',
  'PREPARE',
  'PRIMARY',
  'PROCEDURE',
  'RANGE',
  'READS',
  'REAL',
  'RECURSIVE',
  'REF',
  'REFERENCES',
  'REFERENCING',
  'RELEASE',
  'RESULT',
  'RETURN',
  'RETURNS',
  'REVOKE',
  'RIGHT',
  'ROLLBACK',
  'ROLLUP',
  'ROW',
  'ROWS',
  'SAVEPOINT',
  'SCOPE',
  'SCROLL',
  'SEARCH',
  'SECOND',
  'SELECT',
  'SENSITIVE',
  'SESSION_USER',
  'SET',
  'SIMILAR',
  'SOME', // <- moved over from functions
  'SPECIFIC',
  'SQL',
  'SQLEXCEPTION',
  'SQLSTATE',
  'SQLWARNING',
  'START',
  'STATIC',
  'SUBMULTISET',
  'SYMMETRIC',
  'SYSTEM',
  'SYSTEM_USER',
  'TABLE',
  'TABLESAMPLE',
  'THEN',
  'TIMEZONE_HOUR',
  'TIMEZONE_MINUTE',
  'TO',
  'TRAILING',
  'TRANSLATION',
  'TREAT',
  'TRIGGER',
  'TRUE',
  'UESCAPE',
  'UNION',
  'UNIQUE',
  'UNKNOWN',
  'UNNEST',
  'UPDATE',
  'USER',
  'USING',
  'VALUE',
  'VALUES',
  'WHENEVER',
  'WINDOW',
  'WITHIN',
  'WITHOUT',
  'YEAR',
];
// source: https://github.com/sql-formatter-org/sql-formatter/blob/master/src/languages/sql/sql.keywords.ts
export const dataTypes: string[] = [
  // https://jakewheat.github.io/sql-overview/sql-2008-foundation-grammar.html#_6_1_data_type
  'ARRAY',
  'BIGINT',
  'BINARY LARGE OBJECT',
  'BINARY VARYING',
  'BINARY',
  'BLOB',
  'BOOLEAN',
  'CHAR LARGE OBJECT',
  'CHAR VARYING',
  'CHAR',
  'CHARACTER LARGE OBJECT',
  'CHARACTER VARYING',
  'CHARACTER',
  'CLOB',
  'DATE',
  'DEC',
  'DECIMAL',
  'DOUBLE',
  'FLOAT',
  'INT',
  'INTEGER',
  'INTERVAL',
  'MULTISET',
  'NATIONAL CHAR VARYING',
  'NATIONAL CHAR',
  'NATIONAL CHARACTER LARGE OBJECT',
  'NATIONAL CHARACTER VARYING',
  'NATIONAL CHARACTER',
  'NCHAR LARGE OBJECT',
  'NCHAR VARYING',
  'NCHAR',
  'NCLOB',
  'NUMERIC',
  'SMALLINT',
  'TIME',
  'TIMESTAMP',
  'VARBINARY',
  'VARCHAR',
];

const reservedSelect = expandPhrases(['SELECT [ALL | DISTINCT]']);

const reservedClauses = expandPhrases([
  // queries
  'WITH [RECURSIVE]',
  'FROM',
  'WHERE',
  'GROUP BY [ALL | DISTINCT]',
  'HAVING',
  'WINDOW',
  'PARTITION BY',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'FETCH {FIRST | NEXT}',
  // Data manipulation
  // - insert:
  'INSERT INTO',
  'VALUES',
  // - update:
  'SET',
]);

const standardOnelineClauses = expandPhrases([
  'CREATE [GLOBAL TEMPORARY | LOCAL TEMPORARY] TABLE',
]);

const tabularOnelineClauses = expandPhrases([
  // - create:
  'CREATE [RECURSIVE] VIEW',
  // - update:
  'UPDATE',
  'WHERE CURRENT OF',
  // - delete:
  'DELETE FROM',
  // - drop table:
  'DROP TABLE',
  // - alter table:
  'ALTER TABLE',
  'ADD COLUMN',
  'DROP [COLUMN]',
  'RENAME COLUMN',
  'RENAME TO',
  'ALTER [COLUMN]',
  '{SET | DROP} DEFAULT', // for alter column
  'ADD SCOPE', // for alter column
  'DROP SCOPE {CASCADE | RESTRICT}', // for alter column
  'RESTART WITH', // for alter column
  // - truncate:
  'TRUNCATE TABLE',
  // other
  'SET SCHEMA',
]);

const reservedSetOperations = expandPhrases([
  'UNION [ALL | DISTINCT]',
  'EXCEPT [ALL | DISTINCT]',
  'INTERSECT [ALL | DISTINCT]',
]);

const reservedJoins = expandPhrases([
  'JOIN',
  '{LEFT | RIGHT | FULL} [OUTER] JOIN',
  '{INNER | CROSS} JOIN',
  'NATURAL [INNER] JOIN',
  'NATURAL {LEFT | RIGHT | FULL} [OUTER] JOIN',
]);

const reservedPhrases = expandPhrases([
  'ON {UPDATE | DELETE} [SET NULL | SET DEFAULT]',
  '{ROWS | RANGE} BETWEEN',
]);

const clickhouse: DialectOptions = {
  name: 'clickhouse',
  tokenizerOptions: {
    reservedSelect,
    reservedClauses: [
      ...reservedClauses,
      ...standardOnelineClauses,
      ...tabularOnelineClauses,
    ],
    reservedSetOperations,
    reservedJoins,
    reservedPhrases,
    reservedKeywords: keywords,
    reservedDataTypes: dataTypes,
    reservedFunctionNames: functions,
    stringTypes: [
      { quote: "''-qq-bs", prefixes: ['N', 'U&'] },
      { quote: "''-raw", prefixes: ['X'], requirePrefix: true },
    ],
    identTypes: [`""-qq`, '``'],
    extraParens: ['[]'],
    paramTypes: { positional: true },
    operators: ['||'],
  },
  formatOptions: {
    onelineClauses: [...standardOnelineClauses, ...tabularOnelineClauses],
    tabularOnelineClauses,
  },
};

export function format(query) {
  return formatDialect(query, { dialect: clickhouse });
}
