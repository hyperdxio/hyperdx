import lucene from '@hyperdx/lucene';
import SqlString from 'sqlstring';

import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  extractInnerCHArrayJSType,
  JSDataType,
} from '@/_legacy_chTypes';
import { Metadata, TableConnection } from '@/core/metadata';

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

/**
 * Schema description supplied to {@link TrinoSchemaSerializer}.
 *
 * The serializer is fully self-contained — given the column list it can
 * validate fields, infer numeric vs. string comparisons, and emit Trino SQL
 * without any catalog round-trip. The optional `timestampColumn` enables
 * automatic time-window injection when `timeRange` is provided.
 */
export interface TrinoSchemaConfig {
  columns: Array<{ name: string; type: string }>;
  timestampColumn?: string;
  timeRange?: { startMs: number; endMs: number };
  /**
   * Optional implicit search column expression. When set, bare-text Lucene
   * matches (no field prefix) match against this expression rather than
   * defaulting to OR-across-all-string-columns.
   */
  implicitColumnExpression?: string;
}

const TRINO_NUMERIC_TYPE_PREFIXES = [
  'tinyint',
  'smallint',
  'integer',
  'int',
  'bigint',
  'real',
  'double',
  'decimal',
  'float',
];

const TRINO_BOOL_TYPE_PREFIXES = ['boolean', 'bool'];

function isTrinoNumericType(type: string): boolean {
  const lower = type.toLowerCase();
  return TRINO_NUMERIC_TYPE_PREFIXES.some(p => lower.startsWith(p));
}

function isTrinoBoolType(type: string): boolean {
  const lower = type.toLowerCase();
  return TRINO_BOOL_TYPE_PREFIXES.some(p => lower.startsWith(p));
}

function isTrinoStringType(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    lower.startsWith('varchar') ||
    lower.startsWith('char') ||
    lower === 'string'
  );
}

/**
 * Trino-flavored SQL serializer for Lucene queries.
 *
 * Replaces the previous ClickHouse-specific schema serializer.
 *
 * Key behaviors:
 * - Identifiers double-quoted (Trino convention).
 * - Free-text matches use `lower(col) LIKE lower('%v%')` and OR across all
 *   string columns when no implicit column expression is supplied.
 * - Range/comparison ops emit bare numeric literals against numeric columns
 *   and quoted string literals against string columns.
 * - JSON access via `json_extract_scalar(col, '$.path')`.
 * - Regex via `regexp_like(col, pattern)`.
 * - Unknown columns raise an Error with the column name.
 */
export class TrinoSchemaSerializer extends SQLSerializer {
  private schema: TrinoSchemaConfig;

  constructor(schema: TrinoSchemaConfig) {
    super();
    this.schema = schema;
  }

  /** Look up a column by name; throws if not found. */
  private requireColumn(name: string): { name: string; type: string } {
    const col = this.schema.columns.find(c => c.name === name);
    if (!col) {
      throw new Error(`Column '${name}' not found in schema`);
    }
    return col;
  }

  /** Trino identifier escaping: double quotes, doubled internally. */
  private escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /** Trino string literal escaping: single quotes, doubled internally. */
  private escapeStringLiteral(v: string): string {
    return `'${v.replace(/'/g, "''")}'`;
  }

  /** Helper: find a column without throwing. */
  private findColumn(name: string): { name: string; type: string } | undefined {
    return this.schema.columns.find(c => c.name === name);
  }

  private isNumericField(field: string): boolean {
    const col = this.findColumn(field);
    return !!col && isTrinoNumericType(col.type);
  }

  private isBoolField(field: string): boolean {
    const col = this.findColumn(field);
    return !!col && isTrinoBoolType(col.type);
  }

  /**
   * Resolve a Lucene field reference to a Trino column expression.
   *
   * Supports:
   * - exact column matches
   * - dotted paths into JSON-typed columns via `json_extract_scalar`
   *
   * Throws when no column matches the leading path segment.
   */
  async getColumnForField(field: string, context: SerializerContext) {
    const implicitColumnExpression =
      context.implicitColumnExpression ?? this.schema.implicitColumnExpression;

    if (field === IMPLICIT_FIELD) {
      // Implicit field — handled per-call (eq/range typically not invoked on bare text).
      return {
        column: implicitColumnExpression ?? '',
        propertyType:
          implicitColumnExpression != null ? JSDataType.String : undefined,
        found: implicitColumnExpression != null,
      };
    }

    // Try exact match first.
    const exact = this.findColumn(field);
    if (exact) {
      let propertyType: JSDataType | undefined;
      if (isTrinoNumericType(exact.type)) propertyType = JSDataType.Number;
      else if (isTrinoBoolType(exact.type)) propertyType = JSDataType.Bool;
      else if (isTrinoStringType(exact.type)) propertyType = JSDataType.String;
      else if (exact.type.toLowerCase().startsWith('json'))
        propertyType = JSDataType.JSON;
      else if (exact.type.toLowerCase().startsWith('array'))
        propertyType = JSDataType.Array;
      else if (exact.type.toLowerCase().startsWith('map'))
        propertyType = JSDataType.Map;
      return {
        column: this.escapeIdentifier(exact.name),
        propertyType,
        found: true,
      };
    }

    // Try dotted-path fallback: leading segment must match a column.
    const parts = field.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const head = parts.slice(0, i).join('.');
      const tail = parts.slice(i).join('.');
      const headCol = this.findColumn(head);
      if (headCol) {
        const colType = headCol.type.toLowerCase();
        if (colType.startsWith('json') || colType.startsWith('row')) {
          const expr = `json_extract_scalar(${this.escapeIdentifier(
            headCol.name,
          )}, ${this.escapeStringLiteral('$.' + tail)})`;
          return {
            column: expr,
            propertyType: JSDataType.String,
            found: true,
          };
        }
        if (colType.startsWith('map')) {
          const expr = `element_at(${this.escapeIdentifier(
            headCol.name,
          )}, ${this.escapeStringLiteral(tail)})`;
          return {
            column: expr,
            propertyType: JSDataType.String,
            found: true,
          };
        }
      }
    }

    throw new Error(`Column '${field}' not found in schema`);
  }

  // ----- Comparison / equality overrides emitting Trino-flavored SQL -----

  async eq(
    field: string,
    term: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ): Promise<string> {
    if (field === IMPLICIT_FIELD) {
      return this.fieldSearch(
        field,
        term,
        isNegatedField,
        false,
        false,
        context,
      );
    }
    const col = this.requireColumn(field);
    const colExpr = this.escapeIdentifier(col.name);
    const op = isNegatedField ? '!=' : '=';
    if (isTrinoNumericType(col.type)) {
      const num = Number(term);
      const rhs = Number.isNaN(num) ? this.escapeStringLiteral(term) : `${num}`;
      return `(${colExpr} ${op} ${rhs})`;
    }
    if (isTrinoBoolType(col.type)) {
      const norm = term.trim().toLowerCase();
      const rhs = norm === 'true' ? 'true' : norm === 'false' ? 'false' : term;
      return `(${colExpr} ${op} ${rhs})`;
    }
    return `(${colExpr} ${op} ${this.escapeStringLiteral(term)})`;
  }

  async isNotNull(
    field: string,
    isNegatedField: boolean,
    _context: SerializerContext,
  ): Promise<string> {
    const col = this.requireColumn(field);
    const colExpr = this.escapeIdentifier(col.name);
    return isNegatedField ? `(${colExpr} IS NULL)` : `(${colExpr} IS NOT NULL)`;
  }

  private rangeOp(
    field: string,
    op: '<' | '<=' | '>' | '>=',
    term: string,
  ): string {
    const col = this.requireColumn(field);
    const colExpr = this.escapeIdentifier(col.name);
    if (isTrinoNumericType(col.type)) {
      const num = Number(term);
      const rhs = Number.isNaN(num) ? this.escapeStringLiteral(term) : `${num}`;
      return `(${colExpr} ${op} ${rhs})`;
    }
    return `(${colExpr} ${op} ${this.escapeStringLiteral(term)})`;
  }

  async gte(field: string, term: string, _ctx: SerializerContext) {
    return this.rangeOp(field, '>=', term);
  }
  async lte(field: string, term: string, _ctx: SerializerContext) {
    return this.rangeOp(field, '<=', term);
  }
  async lt(field: string, term: string, _ctx: SerializerContext) {
    return this.rangeOp(field, '<', term);
  }
  async gt(field: string, term: string, _ctx: SerializerContext) {
    return this.rangeOp(field, '>', term);
  }

  async range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
    _context: SerializerContext,
  ): Promise<string> {
    const col = this.requireColumn(field);
    const colExpr = this.escapeIdentifier(col.name);
    const between = isNegatedField ? 'NOT BETWEEN' : 'BETWEEN';
    if (isTrinoNumericType(col.type)) {
      const startNum = Number(start);
      const endNum = Number(end);
      const lhs = Number.isNaN(startNum)
        ? this.escapeStringLiteral(start)
        : `${startNum}`;
      const rhs = Number.isNaN(endNum)
        ? this.escapeStringLiteral(end)
        : `${endNum}`;
      return `(${colExpr} ${between} ${lhs} AND ${rhs})`;
    }
    return `(${colExpr} ${between} ${this.escapeStringLiteral(
      start,
    )} AND ${this.escapeStringLiteral(end)})`;
  }

  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ): Promise<string> {
    const isImplicit = field === IMPLICIT_FIELD;
    if (isImplicit) {
      const implicit =
        context.implicitColumnExpression ??
        this.schema.implicitColumnExpression;
      if (implicit) {
        // Use the configured implicit expression as a single match target.
        const pattern = `${prefixWildcard ? '%' : '%'}${term}${
          suffixWildcard ? '%' : '%'
        }`;
        const sql = `lower(${implicit}) LIKE lower(${this.escapeStringLiteral(
          pattern,
        )})`;
        return isNegatedField ? `(NOT (${sql}))` : `(${sql})`;
      }
      // Fallback: OR across every string column.
      const stringCols = this.schema.columns.filter(c =>
        isTrinoStringType(c.type),
      );
      if (stringCols.length === 0) {
        return isNegatedField ? '(true)' : '(false)';
      }
      const pattern = `%${term}%`;
      const ors = stringCols
        .map(c => {
          const colExpr = this.escapeIdentifier(c.name);
          return `lower(${colExpr}) LIKE lower(${this.escapeStringLiteral(
            pattern,
          )})`;
        })
        .join(' OR ');
      return isNegatedField ? `(NOT (${ors}))` : `(${ors})`;
    }

    // Resolve the column expression — handles dotted JSON / Map paths.
    const resolved = await this.getColumnForField(field, context);
    const colExpr = resolved.column ?? this.escapeIdentifier(field);
    const propertyType = resolved.propertyType;

    if (propertyType === JSDataType.Bool) {
      const norm = term.trim().toLowerCase();
      const rhs = norm === 'true' ? 'true' : norm === 'false' ? 'false' : term;
      return `(${colExpr} ${isNegatedField ? '!=' : '='} ${rhs})`;
    }
    if (propertyType === JSDataType.Number) {
      const num = Number(term);
      if (!Number.isNaN(num)) {
        return `(${colExpr} ${isNegatedField ? '!=' : '='} ${num})`;
      }
    }

    if (term.length === 0) {
      return '(1=1)';
    }

    const pattern = `${prefixWildcard ? '%' : '%'}${term}${
      suffixWildcard ? '%' : '%'
    }`;
    const sql = `lower(${colExpr}) LIKE lower(${this.escapeStringLiteral(
      pattern,
    )})`;
    return isNegatedField ? `(NOT (${sql}))` : `(${sql})`;
  }

  /**
   * Emit a Trino-compatible time-window predicate.
   *
   * Returns null when either `timestampColumn` or `timeRange` is unset
   * — callers can treat that as "no time-window injection".
   */
  emitTimeWindow(): string | null {
    if (!this.schema.timestampColumn || !this.schema.timeRange) return null;
    const col = this.escapeIdentifier(this.schema.timestampColumn);
    const startSecs = Math.floor(this.schema.timeRange.startMs / 1000);
    const endSecs = Math.floor(this.schema.timeRange.endMs / 1000);
    return `${col} BETWEEN from_unixtime(${startSecs}) AND from_unixtime(${endSecs})`;
  }

  /**
   * Convenience wrapper: parse the supplied AST and emit the WHERE-clause
   * fragment for it. When `timestampColumn` and `timeRange` are both set,
   * the time window is appended.
   */
  async serialize(ast: lucene.AST): Promise<string> {
    const where = await genWhereSQL(ast, this);
    const tw = this.emitTimeWindow();
    if (tw && where) {
      return `(${where}) AND (${tw})`;
    }
    if (tw) {
      return tw;
    }
    return where;
  }
}

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
