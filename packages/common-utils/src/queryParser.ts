import lucene from '@hyperdx/lucene';
import SqlString from 'sqlstring';

import { convertCHTypeToPrimitiveJSType, JSDataType } from '@/clickhouse';
import { Metadata, SkipIndexMetadata } from '@/core/metadata';
import { splitAndTrimWithBracket } from '@/core/utils';

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
  private translateField(field: string, context: SerializerContext) {
    if (field === IMPLICIT_FIELD) {
      return context.implicitColumnExpression ?? 'event';
    }

    return `'${field}'`;
  }

  operator(op: lucene.Operator) {
    switch (op) {
      case 'NOT':
      case 'AND NOT':
        return 'AND NOT';
      case 'OR NOT':
        return 'OR NOT';
      // @ts-ignore TODO: Types need to be fixed upstream
      case '&&':
      case '<implicit>':
      case 'AND':
        return 'AND';
      // @ts-ignore TODO: Types need to be fixed upstream
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
    return `${this.translateField(field, context)} ${
      isNegatedField ? 'is not' : 'is'
    } ${term}`;
  }

  async isNotNull(
    field: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
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
      return `${this.translateField(field, context)} ${
        isNegatedField ? 'does not contain' : 'contains'
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
    found: boolean;
    mapKeyIndexExpression?: string;
  }>;

  operator(op: lucene.Operator) {
    switch (op) {
      case 'NOT':
      case 'AND NOT':
        return 'AND NOT';
      case 'OR NOT':
        return 'OR NOT';
      // @ts-ignore TODO: Types need to be fixed upstream
      case '&&':
      case '<implicit>':
      case 'AND':
        return 'AND';
      // @ts-ignore TODO: Types need to be fixed upstream
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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    const expressionPostfix =
      mapKeyIndexExpression && !isNegatedField
        ? ` AND ${mapKeyIndexExpression}`
        : '';
    if (propertyType === JSDataType.JSON) {
      return `notEmpty(${columnJSON?.string}) ${isNegatedField ? '!' : ''}= 1${expressionPostfix}`;
    }
    return `notEmpty(${column}) ${isNegatedField ? '!' : ''}= 1${expressionPostfix}`;
  }

  async gte(field: string, term: string, context: SerializerContext) {
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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

  protected termHasSeperators(term: string): boolean {
    return term.match(/[ -/:-@[-`{-~\t\n\r]+/) != null;
  }

  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
    context: SerializerContext,
  ) {
    const isImplicitField = field === IMPLICIT_FIELD;
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    const expressionPostfix =
      mapKeyIndexExpression &&
      !isNegatedField &&
      (!isImplicitField || !context.isNegatedAndParenthesized)
        ? ` AND ${mapKeyIndexExpression}`
        : '';
    // If it's a string field, we will always try to match with ilike

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
        `(?? ${isNegatedField ? '!' : ''}= CAST(?, 'Float64')${expressionPostfix})`,
        [column, term],
      );
    } else if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.string} ${isNegatedField ? 'NOT ' : ''}ILIKE ?${expressionPostfix})`,
        [`%${term}%`],
      );
    }

    // // If the query is empty, or is a empty quoted string ex: ""
    // // we should match all
    if (term.length === 0) {
      return '(1=1)';
    }

    if (isImplicitField) {
      // For implicit fields that come directly from the Source, we assume there is a bloom filter that can be used to
      // optimize searches with hasToken. Overridden implicit columns (eg. "foo" in "foo:("bar baz")") are assumed
      // to not have bloom filters.
      const shouldUseTokenBf = !context.implicitColumnExpression;

      // For the _source column, we'll try to do whole word searches by default
      // to utilize the token bloom filter unless a prefix/suffix wildcard is specified
      if (prefixWildcard || suffixWildcard) {
        return SqlString.format(
          `(lower(?) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
          [
            SqlString.raw(column ?? ''),
            `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`,
          ],
        );
      } else if (shouldUseTokenBf) {
        // TODO: Check case sensitivity of the index before lowering by default
        // We can't search multiple tokens with `hasToken`, so we need to split up the term into tokens
        const hasSeperators = this.termHasSeperators(term);
        if (hasSeperators) {
          const tokens = this.tokenizeTerm(term);
          return `(${isNegatedField ? 'NOT (' : ''}${[
            ...tokens.map(token =>
              SqlString.format(`hasToken(lower(?), lower(?))`, [
                SqlString.raw(column ?? ''),
                token,
              ]),
            ),
            // If there are symbols in the term, we'll try to match the whole term as well (ex. Scott!)
            SqlString.format(`(lower(?) LIKE lower(?))`, [
              SqlString.raw(column ?? ''),
              `%${term}%`,
            ]),
          ].join(' AND ')}${isNegatedField ? ')' : ''})`;
        } else {
          return SqlString.format(
            `(${isNegatedField ? 'NOT ' : ''}hasToken(lower(?), lower(?)))`,
            [SqlString.raw(column ?? ''), term],
          );
        }
      }
    }

    return SqlString.format(
      `(${column} ${isNegatedField ? 'NOT ' : ''}? ?${expressionPostfix})`,
      [SqlString.raw('ILIKE'), `%${term}%`],
    );
  }

  async range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
    context: SerializerContext,
  ) {
    const { column, found, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
};

export type CustomSchemaConfig = {
  databaseName: string;
  implicitColumnExpression?: string;
  tableName: string;
  connectionId: string;
};

export class CustomSchemaSQLSerializerV2 extends SQLSerializer {
  private metadata: Metadata;
  private tableName: string;
  private databaseName: string;
  private implicitColumnExpression?: string;
  private connectionId: string;
  private skipIndicesPromise?: Promise<SkipIndexMetadata[]>;

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
    const { column, columnJSON, found, propertyType, mapKeyIndexExpression } =
      await this.getColumnForField(field, context);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    const expressionPostfix =
      mapKeyIndexExpression &&
      !isNegatedField &&
      (!isImplicitField || !context.isNegatedAndParenthesized)
        ? ` AND ${mapKeyIndexExpression}`
        : '';

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

    if (term.length === 0) {
      return '(1=1)';
    }

    if (isImplicitField) {
      const shouldUseTokenBf = !context.implicitColumnExpression;

      if (prefixWildcard || suffixWildcard) {
        return SqlString.format(
          `(lower(?) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
          [
            SqlString.raw(column ?? ''),
            `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`,
          ],
        );
      } else if (shouldUseTokenBf) {
        // Check for bloom_filter tokens() index first
        const bloomIndex = await this.findBloomFilterTokensIndex(column ?? '');

        if (bloomIndex.found) {
          // Use hasAll with tokens() - more efficient than hasToken
          // Note: tokens('foo bar') automatically tokenizes, so we use a single hasAll call
          const hasSeperators = this.termHasSeperators(term);
          if (hasSeperators) {
            // Multi-term: hasAll(tokens(...), tokens('foo bar')) AND LIKE fallback
            return `(${isNegatedField ? 'NOT (' : ''}${[
              SqlString.format(
                `hasAll(${bloomIndex.indexExpression}, tokens(?))`,
                [term],
              ),
              // If there are symbols in the term, try to match the whole term as well
              SqlString.format(`(lower(?) LIKE lower(?))`, [
                SqlString.raw(column ?? ''),
                `%${term}%`,
              ]),
            ].join(' AND ')}${isNegatedField ? ')' : ''})`;
          } else {
            // Single term: hasAll(tokens(...), tokens('term'))
            return SqlString.format(
              `(${isNegatedField ? 'NOT ' : ''}hasAll(${bloomIndex.indexExpression}, tokens(?)))`,
              [term],
            );
          }
        }

        // Fallback to existing hasToken logic for tokenbf_v1 indices
        const hasSeperators = this.termHasSeperators(term);
        if (hasSeperators) {
          const tokens = this.tokenizeTerm(term);
          return `(${isNegatedField ? 'NOT (' : ''}${[
            ...tokens.map(token =>
              SqlString.format(`hasToken(lower(?), lower(?))`, [
                SqlString.raw(column ?? ''),
                token,
              ]),
            ),
            // If there are symbols in the term, try to match the whole term as well
            SqlString.format(`(lower(?) LIKE lower(?))`, [
              SqlString.raw(column ?? ''),
              `%${term}%`,
            ]),
          ].join(' AND ')}${isNegatedField ? ')' : ''})`;
        } else {
          return SqlString.format(
            `(${isNegatedField ? 'NOT ' : ''}hasToken(lower(?), lower(?)))`,
            [SqlString.raw(column ?? ''), term],
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
        // Add JSON excatMatch if want to support whole json compare in future, ex: json:"{a: 1234}""
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

    const fieldPrefix = field.split('.')[0];
    const prefixMatch = await this.metadata.getColumn({
      databaseName: this.databaseName,
      tableName: this.tableName,
      column: fieldPrefix,
      connectionId: this.connectionId,
    });

    if (prefixMatch) {
      const fieldPostfix = field.split('.').slice(1).join('.');

      if (prefixMatch.type.startsWith('Map')) {
        const valueType = prefixMatch.type.match(/,\s+(\w+)\)$/)?.[1];
        return {
          found: true,
          columnExpression: SqlString.format(`??[?]`, [
            prefixMatch.name,
            fieldPostfix,
          ]),
          mapKeyIndexExpression: `indexHint(${buildMapContains(`${fieldPrefix}['${fieldPostfix}']`)})`,
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
      }
      // TODO: Support arrays and tuples
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

  /**
   * Finds a bloom_filter skip index that uses tokens() on the given column expression.
   * Returns the full index expression if found, otherwise returns not found.
   *
   * Note: Ignores tokenbf_v1 indices (those are handled by existing hasToken logic).
   */
  private async findBloomFilterTokensIndex(columnExpression: string): Promise<{
    found: boolean;
    indexExpression?: string;
  }> {
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
          if (this.columnsMatch(parsed.innerExpression!, columnExpression)) {
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
   * Compares two column expressions to determine if they refer to the same column.
   * Handles cases where index expression may have transformations like lower(Body) vs Body.
   */
  private columnsMatch(indexColumn: string, searchColumn: string): boolean {
    // Normalize expressions for comparison
    const normalize = (expr: string) =>
      expr.replace(/\s+/g, '').replace(/`/g, '').toLowerCase();

    const normalizedIndex = normalize(indexColumn);
    const normalizedSearch = normalize(searchColumn);

    // Direct match
    if (normalizedIndex === normalizedSearch) {
      return true;
    }

    // Check if index expression contains the search column
    // E.g., lower(Body) should match Body, concatWithSeparator(';',Body,Message) should match Body
    // Extract potential column names (alphanumeric + underscore)
    const searchColumnName = normalizedSearch.match(/\w+/)?.[0];
    if (searchColumnName && normalizedIndex.includes(searchColumnName)) {
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

    return {
      column: expression.columnExpression,
      columnJSON: expression?.columnExpressionJSON,
      propertyType:
        convertCHTypeToPrimitiveJSType(expression.columnType) ?? undefined,
      found: expression.found,
      mapKeyIndexExpression: expression.mapKeyIndexExpression,
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
    // This meeans the field is implicit and the prefix is -
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
    const serialized = `${isNegatedAndParenthesized(binaryAST) ? 'NOT ' : ''}${parenthesized ? '(' : ''}${await serialize(
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

    // const implicitColumn = await this.serializer.getColumnForField(
    //   IMPLICIT_FIELD,
    // );

    // let querySql = this.searchQ
    //   .split(/\s+/)
    //   .map(queryToken =>
    //     SqlString.format(`lower(??) LIKE lower(?)`, [
    //       implicitColumn.column,
    //       `%${queryToken}%`,
    //     ]),
    //   )
    //   .join(' AND ');

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

export async function genEnglishExplanation(query: string): Promise<string> {
  try {
    const parsedQ = parse(query);

    if (parsedQ) {
      const serializer = new EnglishSerializer();
      return await serialize(parsedQ, serializer, {});
    }
  } catch (e) {
    console.warn('Parse failure', query, e);
  }

  return `Message containing ${query}`;
}
