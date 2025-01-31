import lucene from '@hyperdx/lucene';
import SqlString from 'sqlstring';

import { convertCHTypeToPrimitiveJSType, JSDataType } from '@/clickhouse';
import { Metadata } from '@/metadata';

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

const IMPLICIT_FIELD = '<implicit>';

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

interface Serializer {
  operator(op: lucene.Operator): string;
  eq(field: string, term: string, isNegatedField: boolean): Promise<string>;
  isNotNull(field: string, isNegatedField: boolean): Promise<string>;
  gte(field: string, term: string): Promise<string>;
  lte(field: string, term: string): Promise<string>;
  lt(field: string, term: string): Promise<string>;
  gt(field: string, term: string): Promise<string>;
  fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
  ): Promise<string>;
  range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
  ): Promise<string>;
}

class EnglishSerializer implements Serializer {
  private translateField(field: string) {
    if (field === IMPLICIT_FIELD) {
      return 'event';
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

  async eq(field: string, term: string, isNegatedField: boolean) {
    return `${this.translateField(field)} ${
      isNegatedField ? 'is not' : 'is'
    } ${term}`;
  }

  async isNotNull(field: string, isNegatedField: boolean) {
    return `${this.translateField(field)} ${
      isNegatedField ? 'is null' : 'is not null'
    }`;
  }

  async gte(field: string, term: string) {
    return `${this.translateField(field)} is greater than or equal to ${term}`;
  }

  async lte(field: string, term: string) {
    return `${this.translateField(field)} is less than or equal to ${term}`;
  }

  async lt(field: string, term: string) {
    return `${this.translateField(field)} is less than ${term}`;
  }

  async gt(field: string, term: string) {
    return `${this.translateField(field)} is greater than ${term}`;
  }

  // async fieldSearch(field: string, term: string, isNegatedField: boolean) {
  //   return `${this.translateField(field)} ${
  //     isNegatedField ? 'does not contain' : 'contains'
  //   } ${term}`;
  // }

  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
  ) {
    if (field === IMPLICIT_FIELD) {
      return `${this.translateField(field)} ${
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
              : isNegatedField
                ? 'does not have whole word'
                : 'has whole word'
      } ${term}`;
    } else {
      return `${this.translateField(field)} ${
        isNegatedField ? 'does not contain' : 'contains'
      } ${term}`;
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
  private NOT_FOUND_QUERY = '(1 = 0)';

  abstract getColumnForField(field: string): Promise<{
    column?: string;
    columnJSON?: { string: string; number: string };
    propertyType?: JSDataType;
    found: boolean;
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
  async eq(field: string, term: string, isNegatedField: boolean) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.Bool) {
      // numeric and boolean fields must be equality matched
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(`(?? ${isNegatedField ? '!' : ''}= ?)`, [
        column,
        normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm),
      ]);
    } else if (propertyType === JSDataType.Number) {
      return SqlString.format(
        `(${column} ${isNegatedField ? '!' : ''}= CAST(?, 'Float64'))`,
        [term],
      );
    } else if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.string} ${isNegatedField ? '!' : ''}= ?)`,
        [term],
      );
    }
    return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= ?)`, [
      term,
    ]);
  }

  async isNotNull(field: string, isNegatedField: boolean) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.JSON) {
      return `notEmpty(${columnJSON?.string}) ${isNegatedField ? '!' : ''}= 1`;
    }
    return `notEmpty(${column}) ${isNegatedField ? '!' : ''}= 1`;
  }

  async gte(field: string, term: string) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(`(${columnJSON?.number} >= ?)`, [term]);
    }
    return SqlString.format(`(${column} >= ?)`, [term]);
  }

  async lte(field: string, term: string) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(`(${columnJSON?.number} <= ?)`, [term]);
    }
    return SqlString.format(`(${column} <= ?)`, [term]);
  }

  async lt(field: string, term: string) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(`(${columnJSON?.number} < ?)`, [term]);
    }
    return SqlString.format(`(${column} < ?)`, [term]);
  }

  async gt(field: string, term: string) {
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === JSDataType.JSON) {
      return SqlString.format(`(${columnJSON?.number} > ?)`, [term]);
    }
    return SqlString.format(`(${column} > ?)`, [term]);
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
  private tokenizeTerm(term: string): string[] {
    return term.split(/[ -/:-@[-`{-~\t\n\r]+/).filter(t => t.length > 0);
  }

  private termHasSeperators(term: string): boolean {
    return term.match(/[ -/:-@[-`{-~\t\n\r]+/) != null;
  }

  async fieldSearch(
    field: string,
    term: string,
    isNegatedField: boolean,
    prefixWildcard: boolean,
    suffixWildcard: boolean,
  ) {
    const isImplicitField = field === IMPLICIT_FIELD;
    const { column, columnJSON, found, propertyType } =
      await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    // If it's a string field, we will always try to match with ilike

    if (propertyType === JSDataType.Bool) {
      // numeric and boolean fields must be equality matched
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(`(?? ${isNegatedField ? '!' : ''}= ?)`, [
        column,
        normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm),
      ]);
    } else if (propertyType === JSDataType.Number) {
      return SqlString.format(
        `(?? ${isNegatedField ? '!' : ''}= CAST(?, 'Float64'))`,
        [column, term],
      );
    } else if (propertyType === JSDataType.JSON) {
      return SqlString.format(
        `(${columnJSON?.string} ${isNegatedField ? 'NOT ' : ''}ILIKE ?)`,
        [`%${term}%`],
      );
    }

    // // If the query is empty, or is a empty quoted string ex: ""
    // // we should match all
    if (term.length === 0) {
      return '(1=1)';
    }

    if (isImplicitField) {
      // For the _source column, we'll try to do whole word searches by default
      // to utilize the token bloom filter unless a prefix/sufix wildcard is specified
      if (prefixWildcard || suffixWildcard) {
        return SqlString.format(
          `(lower(??) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
          [
            column,
            `${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`,
          ],
        );
      } else {
        // We can't search multiple tokens with `hasToken`, so we need to split up the term into tokens
        const hasSeperators = this.termHasSeperators(term);
        if (hasSeperators) {
          const tokens = this.tokenizeTerm(term);
          return `(${isNegatedField ? 'NOT (' : ''}${[
            ...tokens.map(token =>
              SqlString.format(`hasTokenCaseInsensitive(??, ?)`, [
                column,
                token,
              ]),
            ),
            // If there are symbols in the term, we'll try to match the whole term as well (ex. Scott!)
            SqlString.format(`(lower(??) LIKE lower(?))`, [
              column,
              `%${term}%`,
            ]),
          ].join(' AND ')}${isNegatedField ? ')' : ''})`;
        } else {
          return SqlString.format(
            `(${isNegatedField ? 'NOT ' : ''}hasTokenCaseInsensitive(??, ?))`,
            [column, term],
          );
        }
      }
    } else {
      const shoudUseTokenBf = isImplicitField;
      return SqlString.format(
        `(${column} ${isNegatedField ? 'NOT ' : ''}? ?)`,
        [SqlString.raw(shoudUseTokenBf ? 'LIKE' : 'ILIKE'), `%${term}%`],
      );
    }
  }

  async range(
    field: string,
    start: string,
    end: string,
    isNegatedField: boolean,
  ) {
    const { column, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    return SqlString.format(
      `(${column} ${isNegatedField ? 'NOT ' : ''}BETWEEN ? AND ?)`,
      [this.attemptToParseNumber(start), this.attemptToParseNumber(end)],
    );
  }
}

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
  private async buildColumnExpressionFromField(field: string) {
    const exactMatch = await this.metadata.getColumn({
      databaseName: this.databaseName,
      tableName: this.tableName,
      column: field,
      connectionId: this.connectionId,
    });

    if (exactMatch) {
      return {
        found: true,
        columnType: exactMatch.type,
        columnExpression: exactMatch.name,
        // TODO
        // Add JSON excatMatch if want to support whole json compare in future, ex: json:"{a: 1234}""
      };
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

    throw new Error(`Column not found: ${field}`);
  }

  async getColumnForField(field: string) {
    if (field === IMPLICIT_FIELD) {
      if (!this.implicitColumnExpression) {
        throw new Error(
          'Can not search bare text without an implicit column set.',
        );
      }

      return {
        column: this.implicitColumnExpression,
        columnJSON: undefined,
        propertyType: JSDataType.String,
        found: true,
      };
    }

    const expression = await this.buildColumnExpressionFromField(field);

    return {
      column: expression.columnExpression,
      columnJSON: expression?.columnExpressionJSON,
      propertyType:
        convertCHTypeToPrimitiveJSType(expression.columnType) ?? undefined,
      found: expression.found,
    };
  }
}

async function nodeTerm(
  node: lucene.Node,
  serializer: Serializer,
): Promise<string> {
  const field = node.field[0] === '-' ? node.field.slice(1) : node.field;
  let isNegatedField = node.field[0] === '-';
  const isImplicitField = node.field === IMPLICIT_FIELD;

  // NodeTerm
  if ((node as lucene.NodeTerm).term != null) {
    const nodeTerm = node as lucene.NodeTerm;
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
      return serializer.eq(field, term, isNegatedField);
    }

    if (!nodeTerm.quoted && term === '*') {
      return serializer.isNotNull(field, isNegatedField);
    }

    if (!nodeTerm.quoted && term.substring(0, 2) === '>=') {
      if (isNegatedField) {
        return serializer.lt(field, term.slice(2));
      }
      return serializer.gte(field, term.slice(2));
    }
    if (!nodeTerm.quoted && term.substring(0, 2) === '<=') {
      if (isNegatedField) {
        return serializer.gt(field, term.slice(2));
      }
      return serializer.lte(field, term.slice(2));
    }
    if (!nodeTerm.quoted && term[0] === '>') {
      if (isNegatedField) {
        return serializer.lte(field, term.slice(1));
      }
      return serializer.gt(field, term.slice(1));
    }
    if (!nodeTerm.quoted && term[0] === '<') {
      if (isNegatedField) {
        return serializer.gte(field, term.slice(1));
      }
      return serializer.lt(field, term.slice(1));
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
    );

    // TODO: Handle regex, similarity, boost, prefix
  }
  // NodeRangedTerm
  if ((node as lucene.NodeRangedTerm).inclusive != null) {
    const rangedTerm = node as lucene.NodeRangedTerm;
    return serializer.range(
      field,
      rangedTerm.term_min,
      rangedTerm.term_max,
      isNegatedField,
    );
  }

  throw new Error(`Unexpected Node type. ${node}`);
}

async function serialize(
  ast: lucene.AST | lucene.Node,
  serializer: Serializer,
): Promise<string> {
  // Node Scenarios:
  // 1. NodeTerm: Single term ex. "foo:bar"
  // 2. NodeRangedTerm: Two terms ex. "foo:[bar TO qux]"
  if ((ast as lucene.NodeTerm).term != null) {
    return await nodeTerm(ast as lucene.NodeTerm, serializer);
  }
  if ((ast as lucene.NodeRangedTerm).inclusive != null) {
    return await nodeTerm(ast as lucene.NodeTerm, serializer);
  }

  // AST Scenarios:
  // 1. BinaryAST: Two terms ex. "foo:bar AND baz:qux"
  // 2. LeftOnlyAST: Single term ex. "foo:bar"
  if ((ast as lucene.BinaryAST).right != null) {
    const binaryAST = ast as lucene.BinaryAST;
    const operator = serializer.operator(binaryAST.operator);
    const parenthesized = binaryAST.parenthesized;
    return `${parenthesized ? '(' : ''}${await serialize(
      binaryAST.left,
      serializer,
    )} ${operator} ${await serialize(binaryAST.right, serializer)}${
      parenthesized ? ')' : ''
    }`;
  }

  if ((ast as lucene.LeftOnlyAST).left != null) {
    const leftOnlyAST = ast as lucene.LeftOnlyAST;
    const parenthesized = leftOnlyAST.parenthesized;
    // start is used when ex. "NOT foo:bar"
    return `${parenthesized ? '(' : ''}${
      leftOnlyAST.start != undefined ? `${leftOnlyAST.start} ` : ''
    }${await serialize(leftOnlyAST.left, serializer)}${
      parenthesized ? ')' : ''
    }`;
  }

  // Blank AST, means no text was parsed
  return '';
}

// TODO: can just inline this within getSearchQuery
export async function genWhereSQL(
  ast: lucene.AST,
  serializer: Serializer,
): Promise<string> {
  return await serialize(ast, serializer);
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
      return await serialize(parsedQ, serializer);
    }
  } catch (e) {
    console.warn('Parse failure', query, e);
  }

  return `Message containing ${query}`;
}
