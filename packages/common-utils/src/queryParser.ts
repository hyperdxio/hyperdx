import lucene from '@hyperdx/lucene';
import { chunk } from 'lodash';
import SqlString from 'sqlstring';

import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  convertCHTypeToLuceneSearchType,
  extractInnerCHArrayJSType,
  JSDataType,
} from '@/clickhouse';
import { Metadata, SkipIndexMetadata, TableConnection } from '@/core/metadata';
import {
  parseTokenizerFromTextIndex,
  splitAndTrimWithBracket,
} from '@/core/utils';

/** Max number of tokens to pass to hasAllTokens(), which supports up to 64 tokens as of ClickHouse v25.12. */
const HAS_ALL_TOKENS_CHUNK_SIZE = 50;

function encodeSpecialTokens(query: string): string {
  return query
    .replace(/\\\\/g, 'HDX_BACKSLASH_LITERAL')
    .replace('http://', 'http_COLON_//')
    .replace('https://', 'https_COLON_//')
    .replace(/localhost:(\d{1,5})/, 'localhost_COLON_$1')
    .replace(/\\:/g, 'HDX_COLON');
}
function decodeSpecialTokens(query: string): string {
  return query
    .replace(/\\"/g, '"')
    .replace(/HDX_BACKSLASH_LITERAL/g, '\\')
    .replace('http_COLON_//', 'http://')
    .replace('https_COLON_//', 'https://')
    .replace(/localhost_COLON_(\d{1,5})/, 'localhost:$1')
    .replace(/HDX_COLON/g, ':');
}

export function parse(query: string): lucene.AST {
  return lucene.parse(encodeSpecialTokens(query));
}

function buildMapContains(mapField: string) {
  const splitMapKey = (
    field: string,
  ): { map: string; key: string } | undefined => {
    const bracketIndex = field.indexOf("['");
    if (bracketIndex === -1) return undefined;
    const map = field.slice(0, bracketIndex);
    const key = field.slice(bracketIndex + 2, -2);
    return { map, key };
  };
  const val = splitMapKey(mapField);
  if (!val) return undefined;
  return SqlString.format('mapContains(??, ?)', [val.map, val.key]);
}

const IMPLICIT_FIELD = '<implicit>';

// Type guards for lucene AST types
function isNodeTerm(node: lucene.Node | lucene.AST): node is lucene.NodeTerm {
  return 'term' in node && node.term != null;
}

function isNodeRangedTerm(
  node: lucene.Node | lucene.AST,
): node is lucene.NodeRangedTerm {
  return 'inclusive' in node && node.inclusive != null;
}

function isBinaryAST(ast: lucene.AST | lucene.Node): ast is lucene.BinaryAST {
  return 'right' in ast && ast.right != null;
}

function hasStart(
  ast: lucene.BinaryAST,
): ast is lucene.BinaryAST & { start: lucene.Operator } {
  return 'start' in ast && !!ast.start;
}

function isLeftOnlyAST(
  ast: lucene.AST | lucene.Node,
): ast is lucene.LeftOnlyAST {
  return (
    'left' in ast && ast.left != null && !('right' in ast && ast.right != null)
  );
}

const CLICK_HOUSE_JSON_NUMBER_TYPES = [
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'Int128',
  'Int256',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'UInt128',
  'UInt256',
  'Float32',
  'Float64',
];

/**
 * Find and return the column metadata for the column in the
 * given table with the shortest name that matches a
 * prefix of the given dot-separated field.
 *
 * eg. for field 'a.b.c', check for columns 'a', 'a.b', 'a.b.c' in order.
 **/
async function findPrefixMatch({
  field,
  metadata,
  databaseName,
  tableName,
  connectionId,
}: {
  field: string;
  metadata: Metadata;
  databaseName: string;
  tableName: string;
  connectionId: string;
}): Promise<ColumnMeta | undefined> {
  const fieldParts = field.split('.');
  let fieldPrefix = '';

  for (const part of fieldParts) {
    fieldPrefix = fieldPrefix ? `${fieldPrefix}.${part}` : part;
    const prefixMatch = await metadata.getColumn({
      databaseName,
      tableName,
      column: fieldPrefix,
      connectionId,
    });

    if (prefixMatch) {
      return prefixMatch;
    }
  }
}

interface SerializerContext {
  /** The current implicit column expression, indicating which SQL expression to use when comparing a term to the '<implicit>' field */
  implicitColumnExpression?: string;
  isNegatedAndParenthesized?: boolean;
}

interface Serializer {
  operator(op: lucene.Operator, context: SerializerContext): string;
  eq(
    field: string,
    term: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ): Promise<string>;
  isNotNull(
    field: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ): Promise<string>;
  gte(field: string, term: string, context: SerializerContext): Promise<string>;
  lte(field: string, term: string, context: SerializerContext): Promise<string>;
  lt(field: string, term: string, context: SerializerContext): Promise<string>;
  gt(field: string, term: string, context: SerializerContext): Promise<string>;
  fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ): Promise<string>;
  range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ): Promise<string>;
}

class EnglishSerializer implements Serializer {
  private metadata: Metadata;
  private tableName: string;
  private databaseName: string;
  private connectionId: string;

  constructor({
    metadata,
    databaseName,
    tableName,
    connectionId,
  }: { metadata: Metadata } & CustomSchemaConfig) {
    this.metadata = metadata;
    this.databaseName = databaseName;
    this.tableName = tableName;
    this.connectionId = connectionId;
  }

  private translateField(field: string, context: SerializerContext) {
    if (field === IMPLICIT_FIELD) {
      return context.implicitColumnExpression ?? 'event';
    }

    return `'${field}'`;
  }

  private async getFieldType(field: string) {
    const column = await findPrefixMatch({
      field,
      metadata: this.metadata,
      databaseName: this.databaseName,
      tableName: this.tableName,
      connectionId: this.connectionId,
    });
    const fieldParts = field.split('.');
    const fieldPostfix = fieldParts
      .slice(column ? column.name.split('.').length : 0)
      .join('.');

    if (!column) {
      return {
        isArray: false,
        type: null,
      };
    }

    let jsType = convertCHDataTypeToJSType(column.type);
    const isArray = jsType === JSDataType.Array;
    if (isArray && extractInnerCHArrayJSType(column.type)) {
      jsType = extractInnerCHArrayJSType(column.type);
    }

    return { isArray, type: jsType, fieldPostfix, column: column.name };
  }

  operator(op: lucene.Operator) {
    switch (op) {
      case 'NOT':
      case 'AND NOT':
        return 'AND NOT';
      case 'OR NOT':
        return 'OR NOT';
      // @ts-expect-error TODO: Types need to be fixed upstream
      case '&&':
      case '<implicit>':
      case 'AND':
        return 'AND';
      // @ts-expect-error TODO: Types need to be fixed upstream
      case '||':
      case 'OR':
        return 'OR';
      default:
        throw new Error(`Unexpected operator. ${op}`);
    }
  }

  async eq(
    field: string,
    term: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const { isArray } = await this.getFieldType(field);

    return `${this.translateField(field, context)} ${
      isArray
        ? isNegatedField
          ? 'does not contain'
          : 'contains'
        : isNegatedField
          ? 'is not'
          : 'is'
    } ${term}`;
  }

  async isNotNull(
    field: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const { isArray, type, fieldPostfix, column } =
      await this.getFieldType(field);
    const isArrayOfMaps =
      isArray && (type === JSDataType.Map || type === JSDataType.JSON);

    if (column && isArrayOfMaps && fieldPostfix) {
      return `${this.translateField(column, context)} ${
        isNegatedField
          ? `does not contain an element with non-null ${fieldPostfix}`
          : `contains an element with non-null ${fieldPostfix}`
      }`;
    }

    return `${this.translateField(field, context)} ${
      isNegatedField ? 'is null' : 'is not null'
    }`;
  }

  async gte(field: string, term: string, context: SerializerContext) {
    return `${this.translateField(field, context)} is greater than or equal to ${term}`;
  }

  async lte(field: string, term: string, context: SerializerContext) {
    return `${this.translateField(field, context)} is less than or equal to ${term}`;
  }

  async lt(field: string, term: string, context: SerializerContext) {
    return `${this.translateField(field, context)} is less than ${term}`;
  }

  async gt(field: string, term: string, context: SerializerContext) {
    return `${this.translateField(field, context)} is greater than ${term}`;
  }

  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ) {
    const formattedTerm = term.trim().match(/\s/) ? `"${term}"` : term;

    if (field === IMPLICIT_FIELD) {
      const isUsingTokenSearch = !context.implicitColumnExpression; // Source's implicit column has not been overridden
      return `${this.translateField(field, context)} ${
        prefixWildcard && suffixWildcard
          ? isNegatedField
            ? 'does not contain'
            : 'contains'
          : prefixWildcard
            ? isNegatedField
              ? 'does not end with'
              : 'ends with'
            : suffixWildcard
              ? isNegatedField
                ? 'does not start with'
                : 'starts with'
              : isUsingTokenSearch
                ? isNegatedField
                  ? 'does not have whole word'
                  : 'has whole word'
                : isNegatedField
                  ? 'does not contain'
                  : 'contains'
      } ${formattedTerm}`;
    } else {
      const { isArray, type, column, fieldPostfix } =
        await this.getFieldType(field);
      const isExactMatchType =
        type === JSDataType.Bool || type === JSDataType.Number;
      const isArrayOfMaps =
        isArray && (type === JSDataType.Map || type === JSDataType.JSON);
      const fieldToTranslate = isArrayOfMaps && column ? column : field;
      return `${this.translateField(fieldToTranslate, context)} ${
        isArrayOfMaps
          ? isNegatedField
            ? `does not contain an element with key ${fieldPostfix} and value`
            : `contains an element with key ${fieldPostfix} and value`
          : isArray && !isExactMatchType
            ? isNegatedField
              ? 'does not contain an element containing'
              : 'contains an element containing'
            : isNegatedField
              ? 'does not contain'
              : 'contains'
      } ${formattedTerm}`;
    }
  }

  async range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
  ) {
    return `${field} ${
      isNegatedField ? 'is not' : 'is'
    } between ${start} and ${end}`;
  }
}

export abstract class SQLSerializer implements Serializer {
  protected NOT_FOUND_QUERY = '(1 = 0)';

  abstract getColumnForField(
    field: string,
    context: SerializerContext,
  ): Promise<{
    column?: string;
    columnJSON?: { string: string; number: string };
    propertyType?: JSDataType;
    isArray?: boolean;
    found: boolean;
    mapKeyIndexExpression?: string;
    arrayMapKeyExpression?: string;
  }>;

  operator(op: lucene.Operator) {
    switch (op) {
      case 'NOT':
      case 'AND NOT':
        return 'AND NOT';
      case 'OR NOT':
        return 'OR NOT';
      // @ts-expect-error TODO: Types need to be fixed upstream
      case '&&':
      case '<implicit>':
      case 'AND':
        return 'AND';
      // @ts-expect-error TODO: Types need to be fixed upstream
      case '||':
      case 'OR':
        return 'OR';
      default:
        throw new Error(`Unexpected operator. ${op}`);
    }
  }

  // Only for exact string matches
  async eq(
    field: string,
    term: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
      arrayMapKeyExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }

    if (column && isArray) {
      return renderArrayFieldExpression({
        column,
        mapKey: arrayMapKeyExpression,
        term,
        propertyType,
        isNegatedField,
        exactMatch: true,
      });
    }

    const expressionPostfix =
      mapKeyIndexExpression && !isNegatedField
        ? ` AND ${mapKeyIndexExpression}`
        : '';
    if (propertyType === JSDataType.Bool) {
      // numeric and boolean fields must be equality matched
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(
        `(?? ${isNegatedField ? '!' : ''}= ?${expressionPostfix})`,
        [
          column,
          normTerm === 'true'
            ? 1
            : normTerm === 'false'
              ? 0
              : parseInt(normTerm),
        ],
      );
    } else if (propertyType === JSDataType.Number) {
      return SqlString.format(
        `(${column} ${isNegatedField ? '!' : ''}= CAST(?, 'Float64')${expressionPostfix})`,
        [term],
      );
    } else if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.string} ${isNegatedField ? '!' : ''}= ?${expressionPostfix})`,
        [term],
      );
    }
    return SqlString.format(
      `(${column} ${isNegatedField ? '!' : ''}= ?${expressionPostfix})`,
      [term],
    );
  }

  async isNotNull(
    field: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      mapKeyIndexExpression,
      isArray,
      arrayMapKeyExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    const expressionPostfix =
      mapKeyIndexExpression && !isNegatedField
        ? ` AND ${mapKeyIndexExpression}`
        : '';

    if (
      column &&
      isArray &&
      (propertyType === JSDataType.Map || propertyType === JSDataType.JSON) &&
      arrayMapKeyExpression
    ) {
      const fieldAccess =
        propertyType === JSDataType.Map
          ? SqlString.format('el[?]', [arrayMapKeyExpression])
          : SqlString.format('el.??', [arrayMapKeyExpression]);
      return SqlString.format(
        `${isNegatedField ? 'NOT ' : ''}arrayExists(el -> notEmpty(toString(${fieldAccess})) = 1, ?)`,
        [SqlString.raw(column)],
      );
    }

    if (propertyType === JSDataType.JSON && !isArray) {
      return `notEmpty(${columnJSON?.string}) ${isNegatedField ? '!' : ''}= 1${expressionPostfix}`;
    }
    return `notEmpty(${column}) ${isNegatedField ? '!' : ''}= 1${expressionPostfix}`;
  }

  async gte(field: string, term: string, context: SerializerContext) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (isArray) {
      throw new Error('>= comparison is not supported for Array-type fields');
    }
    const expressionPostfix = mapKeyIndexExpression
      ? ` AND ${mapKeyIndexExpression}`
      : '';
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.number} >= ?${expressionPostfix})`,
        [term],
      );
    }
    return SqlString.format(`(${column} >= ?${expressionPostfix})`, [term]);
  }

  async lte(field: string, term: string, context: SerializerContext) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (isArray) {
      throw new Error('<= comparison is not supported for Array-type fields');
    }
    const expressionPostfix = mapKeyIndexExpression
      ? ` AND ${mapKeyIndexExpression}`
      : '';
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.number} <= ?${expressionPostfix})`,
        [term],
      );
    }
    return SqlString.format(`(${column} <= ?${expressionPostfix})`, [term]);
  }

  async lt(field: string, term: string, context: SerializerContext) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (isArray) {
      throw new Error('< comparison is not supported for Array-type fields');
    }
    const expressionPostfix = mapKeyIndexExpression
      ? ` AND ${mapKeyIndexExpression}`
      : '';
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.number} < ?${expressionPostfix})`,
        [term],
      );
    }
    return SqlString.format(`(${column} < ?${expressionPostfix})`, [term]);
  }

  async gt(field: string, term: string, context: SerializerContext) {
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (isArray) {
      throw new Error('> comparison is not supported for Array-type fields');
    }
    const expressionPostfix = mapKeyIndexExpression
      ? ` AND ${mapKeyIndexExpression}`
      : '';
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.number} > ?${expressionPostfix})`,
        [term],
      );
    }
    return SqlString.format(`(${column} > ?${expressionPostfix})`, [term]);
  }

  // TODO: Not sure if SQL really needs this or if it'll coerce itself
  private attemptToParseNumber(term: string): string | number {
    const number = Number.parseFloat(term);
    if (Number.isNaN(number)) {
      return term;
    }
    return number;
  }

  // Ref: https://clickhouse.com/codebrowser/ClickHouse/src/Functions/HasTokenImpl.h.html#_ZN2DB12HasTokenImpl16isTokenSeparatorEDu
  // Split by anything that's ascii 0-128, that's not a letter or a number
  protected tokenizeTerm(term: string): string[] {
    return term.split(/[ -/:-@[-`{-~\t\n\r]+/).filter(t => t.length > 0);
  }

  protected termHasSeparators(term: string): boolean {
    return term.match(/[ -/:-@[-`{-~\t\n\r]+/) != null;
  }

  abstract fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ): Promise<string>;

  async range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const { column, found, mapKeyIndexExpression, isArray } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (isArray) {
      throw new Error(
        'range comparison is not supported for Array-type fields',
      );
    }
    const expressionPostfix =
      mapKeyIndexExpression && !isNegatedField
        ? ` AND ${mapKeyIndexExpression}`
        : '';
    return SqlString.format(
      `(${column} ${isNegatedField ? 'NOT ' : ''}BETWEEN ? AND ?${expressionPostfix})`,
      [this.attemptToParseNumber(start), this.attemptToParseNumber(end)],
    );
  }
}

type CustomSchemaSQLColumnExpression = {
  found: boolean;
  columnType: string;
  columnExpression: string;
  columnExpressionJSON?: {
    string: string;
    number: string;
  };
  mapKeyIndexExpression?: string;
  arrayMapKeyExpression?: string;
};

export type CustomSchemaConfig = {
  databaseName: string;
  implicitColumnExpression?: string;
  tableName: string;
  connectionId: string;
};

function renderArrayFieldExpression({
  column,
  mapKey,
  term,
  isNegatedField,
  propertyType,
  exactMatch,
}: {
  column: string;
  mapKey?: string;
  term: string;
  isNegatedField: boolean;
  propertyType?: JSDataType;
  exactMatch: boolean;
}) {
  const prefix = isNegatedField ? 'NOT ' : '';

  if (propertyType === JSDataType.Number) {
    return SqlString.format(`${prefix}has(?, CAST(?, 'Float64'))`, [
      SqlString.raw(column),
      term,
    ]);
  }

  if (propertyType === JSDataType.Bool) {
    const normTerm = `${term}`.trim().toLowerCase();
    const comparisonValue =
      normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : term;
    return SqlString.format(`${prefix}has(?, ?)`, [
      SqlString.raw(column),
      comparisonValue,
    ]);
  }

  if (propertyType === JSDataType.Map) {
    if (!mapKey) {
      throw new Error(
        `Map key expression is required for searching column ${column}. Try '${column}.key:value'`,
      );
    }
    return exactMatch
      ? SqlString.format(`${prefix}arrayExists(el -> el[?] = ?, ?)`, [
          mapKey,
          term,
          SqlString.raw(column),
        ])
      : SqlString.format(`${prefix}arrayExists(el -> el[?] ILIKE ?, ?)`, [
          mapKey,
          `%${term}%`,
          SqlString.raw(column),
        ]);
  }

  if (propertyType === JSDataType.JSON) {
    if (!mapKey) {
      throw new Error(
        `Map key expression is required for searching column ${column}. Try '${column}.key:value'`,
      );
    }
    return exactMatch
      ? SqlString.format(`${prefix}arrayExists(el -> toString(el.??) = ?, ?)`, [
          mapKey,
          term,
          SqlString.raw(column),
        ])
      : SqlString.format(
          `${prefix}arrayExists(el -> toString(el.??) ILIKE ?, ?)`,
          [mapKey, `%${term}%`, SqlString.raw(column)],
        );
  }

  const stringifiedElement =
    propertyType === JSDataType.String
      ? 'el'
      : SqlString.format('toString(el)', [SqlString.raw(column)]);

  return exactMatch && propertyType === JSDataType.String
    ? SqlString.format(`${prefix}has(?, ?)`, [SqlString.raw(column), term])
    : exactMatch
      ? SqlString.format(
          `${prefix}arrayExists(el -> ${stringifiedElement} = ?, ?)`,
          [term, SqlString.raw(column)],
        )
      : SqlString.format(
          `${prefix}arrayExists(el -> ${stringifiedElement} ILIKE ?, ?)`,
          [`%${term}%`, SqlString.raw(column)],
        );
}

export class CustomSchemaSQLSerializerV2 extends SQLSerializer {
  private metadata: Metadata;
  private tableName: string;
  private databaseName: string;
  private implicitColumnExpression?: string;
  private connectionId: string;
  private skipIndicesPromise?: Promise<SkipIndexMetadata[]>;
  private enableTextIndexPromise?: Promise<boolean>;

  constructor({
    metadata,
    databaseName,
    tableName,
    connectionId,
    implicitColumnExpression,
  }: { metadata: Metadata } & CustomSchemaConfig) {
    super();
    this.metadata = metadata;
    this.databaseName = databaseName;
    this.tableName = tableName;
    this.implicitColumnExpression = implicitColumnExpression;
    this.connectionId = connectionId;

    // Pre-fetch skip indices for potential bloom filter optimization
    this.skipIndicesPromise = this.metadata
      .getSkipIndices({
        databaseName,
        tableName,
        connectionId,
      })
      .catch(error => {
        console.error('Error fetching skip indices:', error);
        return [];
      });

    // Pre-fetch value of the enable_full_text_index setting
    this.enableTextIndexPromise = this.metadata
      .getSetting({
        settingName: 'enable_full_text_index',
        connectionId,
      })
      .then(value => value === '1')
      .catch(error => {
        console.error('Error fetching enable_full_text_index setting:', error);
        return false;
      });
  }

  /**
   * Override fieldSearch to support bloom_filter tokens() indices optimization.
   * Falls back to base class hasToken behavior when no suitable bloom_filter index is found.
   */
  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ) {
    const isImplicitField = field === IMPLICIT_FIELD;
    const {
      column,
      columnJSON,
      found,
      propertyType,
      isArray,
      mapKeyIndexExpression,
      arrayMapKeyExpression,
    } = await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    const expressionPostfix =
      mapKeyIndexExpression &&
      !isNegatedField &&
      (!isImplicitField || !context.isNegatedAndParenthesized)
        ? ` AND ${mapKeyIndexExpression}`
        : '';

    if (isArray) {
      return renderArrayFieldExpression({
        column,
        mapKey: arrayMapKeyExpression,
        term,
        propertyType,
        isNegatedField,
        exactMatch: false,
      });
    }

    if (propertyType === JSDataType.Bool) {
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(
        `(?? ${isNegatedField ? '!' : ''}= ?${expressionPostfix})`,
        [
          column,
          normTerm === 'true'
            ? 1
            : normTerm === 'false'
              ? 0
              : parseInt(normTerm),
        ],
      );
    } else if (propertyType === JSDataType.Number) {
      return SqlString.format(
        `(?? ${isNegatedField ? '!' : ''}= CAST(?, 'Float64')${expressionPostfix})`,
        [column, term],
      );
    } else if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.string} ${isNegatedField ? 'NOT ' : ''}ILIKE ?${expressionPostfix})`,
        [`%${term}%`],
      );
    }

    // If the term is empty, return a no-op that always evaluates to true
    if (term.length === 0) {
      return '(1=1)';
    }

    if (isImplicitField) {
      const shouldUseTokenBf = !context.implicitColumnExpression;

      if (prefixWildcard || suffixWildcard) {
        return SqlString.format(
          `(lower(?) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
          [
            SqlString.raw(column),
            `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`,
          ],
        );
      } else if (shouldUseTokenBf) {
        // First check for a text index, and use it if possible
        // Note: We check that enable_full_text_index = 1, otherwise hasAllTokens() errors
        const isTextIndexEnabled = await this.enableTextIndexPromise;
        const textIndex = isTextIndexEnabled
          ? await this.findTextIndex(column)
          : undefined;

        if (textIndex) {
          const tokenizer = parseTokenizerFromTextIndex(textIndex);

          // HDX-3259: Support other tokenizers by overriding tokenizeTerm, termHasSeparators, and batching logic
          if (tokenizer?.type === 'splitByNonAlpha') {
            const tokens = this.tokenizeTerm(term);
            const hasSeparators = this.termHasSeparators(term);

            // Batch tokens to avoid exceeding hasAllTokens limit (64)
            const tokenBatches = chunk(tokens, HAS_ALL_TOKENS_CHUNK_SIZE);
            const hasAllTokensExpressions = tokenBatches.map(batch =>
              SqlString.format(`hasAllTokens(?, ?)`, [
                SqlString.raw(column),
                batch.join(' '),
              ]),
            );

            if (hasSeparators || tokenBatches.length > 1) {
              // Multi-token, or term containing token separators: hasAllTokens(..., 'foo bar') AND lower(...) LIKE '%foo bar%'
              return `(${isNegatedField ? 'NOT (' : ''}${[
                ...hasAllTokensExpressions,
                SqlString.format(`(lower(?) LIKE lower(?))`, [
                  SqlString.raw(column),
                  `%${term}%`,
                ]),
              ].join(' AND ')}${isNegatedField ? ')' : ''})`;
            } else {
              // Single token, without token separators: hasAllTokens(..., 'term')
              return `(${isNegatedField ? 'NOT ' : ''}${hasAllTokensExpressions.join(' AND ')})`;
            }
          }
        }

        // Check for bloom_filter tokens() index first
        const hasSeparators = this.termHasSeparators(term);
        const bloomIndex = await this.findBloomFilterTokensIndex(column);

        if (bloomIndex.found) {
          const indexHasLower = /\blower\s*\(/.test(bloomIndex.indexExpression);
          const termTokensExpression = indexHasLower
            ? SqlString.format('tokens(lower(?))', [term])
            : SqlString.format('tokens(?)', [term]);

          // Use hasAll with tokens() - more efficient than hasToken
          // Note: tokens('foo bar') automatically tokenizes, so we use a single hasAll call
          if (hasSeparators) {
            // Multi-term: hasAll(tokens(...), tokens('foo bar')) AND LIKE fallback
            return `(${isNegatedField ? 'NOT (' : ''}${[
              `hasAll(${bloomIndex.indexExpression}, ${termTokensExpression})`,
              // If there are token separators in the term, try to match the whole term as well
              SqlString.format(`(lower(?) LIKE lower(?))`, [
                SqlString.raw(column),
                `%${term}%`,
              ]),
            ].join(' AND ')}${isNegatedField ? ')' : ''})`;
          } else {
            // Single term: hasAll(tokens(...), tokens('term'))
            return `(${isNegatedField ? 'NOT ' : ''}hasAll(${bloomIndex.indexExpression}, ${termTokensExpression}))`;
          }
        }

        // Fallback to using tokenbf_v1 indices if no bloom_filter index is found
        if (hasSeparators) {
          const tokens = this.tokenizeTerm(term);
          return `(${isNegatedField ? 'NOT (' : ''}${[
            ...tokens.map(token =>
              SqlString.format(`hasToken(lower(?), lower(?))`, [
                SqlString.raw(column),
                token,
              ]),
            ),
            // If there are symbols in the term, try to match the whole term as well
            SqlString.format(`(lower(?) LIKE lower(?))`, [
              SqlString.raw(column),
              `%${term}%`,
            ]),
          ].join(' AND ')}${isNegatedField ? ')' : ''})`;
        } else {
          return SqlString.format(
            `(${isNegatedField ? 'NOT ' : ''}hasToken(lower(?), lower(?)))`,
            [SqlString.raw(column), term],
          );
        }
      }
    }

    return SqlString.format(
      `(${column} ${isNegatedField ? 'NOT ' : ''}? ?${expressionPostfix})`,
      [SqlString.raw('ILIKE'), `%${term}%`],
    );
  }

  /**
   * Translate field from user ex. column.property.subproperty to SQL expression
   * Supports:
   * - Materialized Columns
   * - Map
   * - JSON Strings (via JSONExtract)
   * TODO:
   * - Nested Map
   * - JSONExtract for non-string types
   */
  private async buildColumnExpressionFromField(
    field: string,
  ): Promise<CustomSchemaSQLColumnExpression> {
    const exactMatch = await this.metadata.getColumn({
      databaseName: this.databaseName,
      tableName: this.tableName,
      column: field,
      connectionId: this.connectionId,
    });

    if (exactMatch) {
      const columnExpression: CustomSchemaSQLColumnExpression = {
        found: true,
        columnType: exactMatch.type,
        columnExpression: exactMatch.name,
        // TODO
        // Add JSON exactMatch if want to support whole json compare in future, ex: json:"{a: 1234}""
      };
      let materializedColumns: Map<string, string>;
      try {
        // This won't work for CTEs
        materializedColumns =
          await this.metadata.getMaterializedColumnsLookupTable({
            databaseName: this.databaseName,
            tableName: this.tableName,
            connectionId: this.connectionId,
          });
      } catch (e) {
        console.debug('Error in getMaterializedColumnsLookupTable', e);
        materializedColumns = new Map();
      }
      const materializedColumn = (() => {
        for (const [
          materializedTarget,
          materializedName,
        ] of materializedColumns.entries()) {
          if (materializedName === field) {
            return { materializedTarget, materializedName };
          }
        }
        return undefined;
      })();
      if (materializedColumn) {
        const mapContainsStatement = buildMapContains(
          materializedColumn.materializedTarget,
        );
        if (mapContainsStatement) {
          columnExpression.mapKeyIndexExpression = `indexHint(${mapContainsStatement})`;
        }
      }
      return columnExpression;
    }

    const prefixMatch = await findPrefixMatch({
      field,
      metadata: this.metadata,
      databaseName: this.databaseName,
      tableName: this.tableName,
      connectionId: this.connectionId,
    });

    if (prefixMatch) {
      const prefixParts = prefixMatch.name.split('.');
      const fieldPostfix = field.split('.').slice(prefixParts.length).join('.');

      if (prefixMatch.type.startsWith('Map')) {
        const valueType = prefixMatch.type.match(/,\s+(\w+)\)$/)?.[1];
        return {
          found: true,
          columnExpression: SqlString.format(`??[?]`, [
            prefixMatch.name,
            fieldPostfix,
          ]),
          mapKeyIndexExpression: `indexHint(${buildMapContains(`${prefixMatch.name}['${fieldPostfix}']`)})`,
          columnType: valueType ?? 'Unknown',
        };
      } else if (prefixMatch.type.startsWith('JSON')) {
        // ignore original column expression at here
        // need to know the term to decide which expression to read
        // TODO: add real columnExpression when CH update JSON data type
        return {
          found: true,
          columnExpression: '',
          columnExpressionJSON: {
            string: SqlString.format(`toString(??)`, [field]),
            number: SqlString.format(`dynamicType(??) in (?) and ??`, [
              field,
              CLICK_HOUSE_JSON_NUMBER_TYPES,
              field,
            ]),
          },
          columnType: 'JSON',
        };
      } else if (prefixMatch.type === 'String') {
        // TODO: Support non-strings
        const nestedPaths = fieldPostfix.split('.');
        return {
          found: true,
          columnExpression: SqlString.format(
            `JSONExtractString(??, ${Array(nestedPaths.length)
              .fill('?')
              .join(',')})`,
            [prefixMatch.name, ...nestedPaths],
          ),
          columnType: 'String',
        };
      } else if (prefixMatch.type.startsWith('Array')) {
        return {
          found: true,
          columnType: prefixMatch.type,
          columnExpression: prefixMatch.name,
          arrayMapKeyExpression: fieldPostfix,
        };
      }
      // TODO: Support tuples
      throw new Error('Unsupported column type for prefix match');
    }

    // It might be an alias, let's just try the column
    // TODO: Verify aliases
    return {
      found: true,
      columnExpression: field,
      columnType: 'Unknown',
    };
    // throw new Error(`Column not found: ${field}`);
  }

  private async findTextIndex(
    columnExpression: string,
  ): Promise<SkipIndexMetadata | undefined> {
    const skipIndices = await this.skipIndicesPromise;

    if (!skipIndices || skipIndices.length === 0) {
      return undefined;
    }

    // Note: Text index expressions should not be wrapped in tokens() or preprocessing functions like lower().
    return skipIndices.find(
      idx =>
        idx.type === 'text' &&
        this.indexCoversColumn(idx.expression, columnExpression),
    );
  }

  /**
   * Finds a bloom_filter skip index that uses tokens() on the given column expression.
   * Returns the full index expression if found, otherwise returns not found.
   *
   * Note: Ignores tokenbf_v1 indices (those are handled by existing hasToken logic).
   */
  private async findBloomFilterTokensIndex(columnExpression: string): Promise<
    | {
        found: true;
        indexExpression: string;
      }
    | { found: false }
  > {
    try {
      const skipIndices = await this.skipIndicesPromise;

      if (!skipIndices || skipIndices.length === 0) {
        return { found: false };
      }

      // Look for bloom_filter indices (not tokenbf_v1)
      const bloomFilterIndices = skipIndices.filter(
        idx => idx.type === 'bloom_filter',
      );

      // Find index that uses tokens() on a matching column
      for (const index of bloomFilterIndices) {
        const parsed = Metadata.parseTokensExpression(index.expression);

        if (parsed.hasTokens) {
          // Match the inner expression against our column
          if (
            this.indexCoversColumn(parsed.innerExpression, columnExpression)
          ) {
            return {
              found: true,
              indexExpression: index.expression, // e.g., "tokens(lower(Body))"
            };
          }
        }
      }

      return { found: false };
    } catch (error) {
      // If index lookup fails, fall back to default behavior
      console.warn('Failed to fetch skip indices:', error);
      return { found: false };
    }
  }

  /**
   * Compares two expressions to determine if the index expression refers to the search column.
   * Handles cases where index expression may have transformations like lower(Body) vs Body.
   */
  indexCoversColumn(indexExpression: string, searchColumn: string): boolean {
    // Normalize expressions for comparison
    const normalize = (expr: string) =>
      expr.replace(/\s+/g, '').replace(/`/g, '');

    const normalizedIndex = normalize(indexExpression);
    const normalizedSearch = normalize(searchColumn);

    // Direct match
    if (normalizedIndex === normalizedSearch) {
      return true;
    }

    // Check if index expression contains the search column
    // E.g., lower(Body) should match Body, concatWithSeparator(';',Body,Message) should match Body
    // Extract potential column names (alphanumeric + underscore)
    const indexExpressionWords = normalizedIndex.match(/\w+/g);
    const searchColumnName = normalizedSearch.match(/\w+/)?.[0];
    if (
      searchColumnName &&
      indexExpressionWords &&
      indexExpressionWords.includes(searchColumnName)
    ) {
      return true;
    }

    return false;
  }

  async getColumnForField(field: string, context: SerializerContext) {
    const implicitColumnExpression =
      context.implicitColumnExpression ?? this.implicitColumnExpression;
    if (field === IMPLICIT_FIELD && !implicitColumnExpression) {
      throw new Error(
        'Can not search bare text without an implicit column set.',
      );
    }

    const fieldFinal =
      field === IMPLICIT_FIELD ? implicitColumnExpression! : field;

    if (
      field === IMPLICIT_FIELD &&
      implicitColumnExpression === this.implicitColumnExpression // Source's implicit column has not been overridden
    ) {
      // Sources can specify multi-column implicit columns, eg. Body and Message, in
      // which case we search the combined string `concatWithSeparator(';', Body, Message)`.
      const expressions = splitAndTrimWithBracket(fieldFinal);

      return {
        column:
          expressions.length > 1
            ? `concatWithSeparator(';',${expressions.join(',')})`
            : fieldFinal,
        columnJSON: undefined,
        propertyType: JSDataType.String,
        found: true,
      };
    }

    const expression = await this.buildColumnExpressionFromField(fieldFinal);

    const { type, isArray } = convertCHTypeToLuceneSearchType(
      expression.columnType,
    );

    return {
      column: expression.columnExpression,
      columnJSON: expression?.columnExpressionJSON,
      propertyType: type ?? undefined,
      isArray,
      found: expression.found,
      mapKeyIndexExpression: expression.mapKeyIndexExpression,
      arrayMapKeyExpression: isArray
        ? expression.arrayMapKeyExpression
        : undefined,
    };
  }
}

async function nodeTerm(
  node: lucene.Node,
  serializer: Serializer,
  context: SerializerContext,
): Promise<string> {
  const field = node.field[0] === '-' ? node.field.slice(1) : node.field;
  let isNegatedField = node.field[0] === '-';
  const isImplicitField = node.field === IMPLICIT_FIELD;

  // NodeTerm
  if (isNodeTerm(node)) {
    const nodeTerm = node;
    let term = decodeSpecialTokens(nodeTerm.term);
    // We should only negate the search for negated bare terms (ex. '-5')
    // This means the field is implicit and the prefix is -
    if (isImplicitField && nodeTerm.prefix === '-') {
      isNegatedField = true;
    }
    // Otherwise, if we have a negated term for a field (ex. 'level:-5')
    // we should not negate the search, and search for -5
    if (!isImplicitField && nodeTerm.prefix === '-') {
      term = nodeTerm.prefix + decodeSpecialTokens(nodeTerm.term);
    }

    // TODO: Decide if this is good behavior
    // If the term is quoted, we should search for the exact term in a property (ex. foo:"bar")
    // Implicit field searches should still use substring matching (ex. "foo bar")
    if (nodeTerm.quoted && !isImplicitField) {
      return serializer.eq(field, term, isNegatedField, context);
    }

    if (!nodeTerm.quoted && term === '*') {
      return serializer.isNotNull(field, isNegatedField, context);
    }

    if (!nodeTerm.quoted && term.substring(0, 2) === '>=') {
      if (isNegatedField) {
        return serializer.lt(field, term.slice(2), context);
      }
      return serializer.gte(field, term.slice(2), context);
    }
    if (!nodeTerm.quoted && term.substring(0, 2) === '<=') {
      if (isNegatedField) {
        return serializer.gt(field, term.slice(2), context);
      }
      return serializer.lte(field, term.slice(2), context);
    }
    if (!nodeTerm.quoted && term[0] === '>') {
      if (isNegatedField) {
        return serializer.lte(field, term.slice(1), context);
      }
      return serializer.gt(field, term.slice(1), context);
    }
    if (!nodeTerm.quoted && term[0] === '<') {
      if (isNegatedField) {
        return serializer.gte(field, term.slice(1), context);
      }
      return serializer.lt(field, term.slice(1), context);
    }

    let prefixWildcard = false;
    let suffixWildcard = false;
    if (!nodeTerm.quoted && term[0] === '*') {
      prefixWildcard = true;
      term = term.slice(1);
    }
    if (!nodeTerm.quoted && term[term.length - 1] === '*') {
      suffixWildcard = true;
      term = term.slice(0, -1);
    }

    return serializer.fieldSearch(
      field,
      term,
      isNegatedField,
      prefixWildcard,
      suffixWildcard,
      context,
    );

    // TODO: Handle regex, similarity, boost, prefix
  }
  // NodeRangedTerm
  if (isNodeRangedTerm(node)) {
    const rangedTerm = node;
    return serializer.range(
      field,
      rangedTerm.term_min,
      rangedTerm.term_max,
      isNegatedField,
      context,
    );
  }

  throw new Error(`Unexpected Node type. ${node}`);
}

function createSerializerContext(
  currentContext: SerializerContext,
  ast: lucene.BinaryAST | lucene.LeftOnlyAST,
) {
  // For syntax like `foo:(bar baz)` or `foo:("bar baz")`, the implicit field for the inner expression must be `foo`
  if (ast.field && ast.parenthesized && ast.field !== IMPLICIT_FIELD) {
    const fieldWithoutNegation = ast.field?.startsWith('-')
      ? ast.field.slice(1)
      : ast.field;

    return {
      ...currentContext,
      implicitColumnExpression: fieldWithoutNegation,
      ...(isNegatedAndParenthesized(ast)
        ? { isNegatedAndParenthesized: true }
        : {}),
    };
  } else {
    return currentContext;
  }
}

/** Returns true if the AST is of the form `-[field]:([terms...])` */
function isNegatedAndParenthesized(ast: lucene.BinaryAST | lucene.LeftOnlyAST) {
  return ast.parenthesized && ast.field?.startsWith('-');
}

async function serialize(
  ast: lucene.AST | lucene.Node,
  serializer: Serializer,
  context: SerializerContext,
): Promise<string> {
  // Node Scenarios:
  // 1. NodeTerm: Single term ex. "foo:bar"
  // 2. NodeRangedTerm: Two terms ex. "foo:[bar TO qux]"
  if (isNodeTerm(ast)) {
    return await nodeTerm(ast, serializer, context);
  }
  if (isNodeRangedTerm(ast)) {
    return await nodeTerm(ast, serializer, context);
  }

  // AST Scenarios:
  // 1. BinaryAST: Two terms ex. "foo:bar AND baz:qux"
  // 2. LeftOnlyAST: Single term ex. "foo:bar"
  if (isBinaryAST(ast)) {
    const binaryAST = ast;
    const operator = serializer.operator(binaryAST.operator, context);
    const parenthesized = binaryAST.parenthesized;

    const newContext = createSerializerContext(context, binaryAST);
    const serialized = `${isNegatedAndParenthesized(binaryAST) ? 'NOT ' : ''}${parenthesized ? '(' : ''}${
      hasStart(binaryAST) ? `${binaryAST.start} ` : ''
    }${await serialize(
      binaryAST.left,
      serializer,
      newContext,
    )} ${operator} ${await serialize(binaryAST.right, serializer, newContext)}${
      parenthesized ? ')' : ''
    }`;
    return serialized;
  }

  if (isLeftOnlyAST(ast)) {
    const leftOnlyAST = ast;
    const parenthesized = leftOnlyAST.parenthesized;

    const newContext = createSerializerContext(context, leftOnlyAST);

    // start is used when ex. "NOT foo:bar"
    const serialized = `${isNegatedAndParenthesized(leftOnlyAST) ? 'NOT ' : ''}${parenthesized ? '(' : ''}${
      leftOnlyAST.start != undefined ? `${leftOnlyAST.start} ` : ''
    }${await serialize(leftOnlyAST.left, serializer, newContext)}${
      parenthesized ? ')' : ''
    }`;

    return serialized;
  }

  // Blank AST, means no text was parsed
  return '';
}

// TODO: can just inline this within getSearchQuery
export async function genWhereSQL(
  ast: lucene.AST,
  serializer: Serializer,
): Promise<string> {
  return await serialize(ast, serializer, {});
}

export class SearchQueryBuilder {
  private readonly searchQ: string;

  private readonly conditions: string[];

  private serializer: SQLSerializer;

  constructor(searchQ: string, serializer: SQLSerializer) {
    this.conditions = [];
    this.searchQ = searchQ;
    // init default serializer
    this.serializer = serializer;
  }

  setSerializer(serializer: SQLSerializer) {
    this.serializer = serializer;
    return this;
  }

  getSerializer() {
    return this.serializer;
  }

  private async genSearchQuery() {
    if (!this.searchQ) {
      return '';
    }

    const parsedQ = parse(this.searchQ);

    return await genWhereSQL(parsedQ, this.serializer);
  }

  and(condition: string) {
    if (condition && condition.trim()) {
      this.conditions.push(`(${condition})`);
    }
    return this;
  }

  async build() {
    const searchQuery = await this.genSearchQuery();
    if (this.searchQ) {
      this.and(searchQuery);
    }
    return this.conditions.join(' AND ');
  }
}

export async function genEnglishExplanation({
  query,
  metadata,
  tableConnection,
}: {
  query: string;
  tableConnection: TableConnection;
  metadata: Metadata;
}): Promise<string> {
  try {
    const { tableName, databaseName, connectionId } = tableConnection;
    const parsedQ = parse(query);

    if (parsedQ) {
      const serializer = new EnglishSerializer({
        metadata,
        tableName,
        databaseName,
        connectionId,
      });
      return await serialize(parsedQ, serializer, {});
    }
  } catch (e) {
    console.warn('Parse failure', query, e);
  }

  return `Message containing ${query}`;
}
