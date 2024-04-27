import lucene from '@hyperdx/lucene';
import { serializeError } from 'serialize-error';
import SqlString from 'sqlstring';

import { LogPlatform, LogType } from '@/utils/logParser';

import { PropertyTypeMappingsModel } from './propertyTypeMappingsModel';

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

export const msToBigIntNs = (ms: number) => BigInt(ms * 1000000);
export const isLikelyTokenTerm = (term: string) => {
  return term.length >= 16;
};

const customColumnMap: { [level: string]: string } = {
  [IMPLICIT_FIELD]: '_source',
  body: '_hdx_body',
  duration: '_duration',
  end_timestamp: 'end_timestamp',
  host: '_host',
  hyperdx_event_size: '_hyperdx_event_size',
  hyperdx_platform: '_platform',
  level: 'severity_text',
  parent_span_id: 'parent_span_id',
  rum_session_id: '_rum_session_id',
  service: '_service',
  span_id: 'span_id',
  span_name: 'span_name',
  timestamp: 'timestamp',
  trace_id: 'trace_id',
  userEmail: '_user_email',
  userId: '_user_id',
  userName: '_user_name',
  // TODO: eventually we might want to materialize these fields
  'object.regarding.kind':
    "coalesce(_string_attributes['object.regarding.kind'], _string_attributes['object.involvedObject.kind'])",
  'object.regarding.name':
    "coalesce(_string_attributes['object.regarding.name'], _string_attributes['object.involvedObject.name'])",
};
export const customColumnMapType: {
  [property: string]: 'string' | 'number' | 'bool';
} = {
  [IMPLICIT_FIELD]: 'string',
  body: 'string',
  duration: 'number',
  host: 'string',
  hyperdx_event_size: 'number',
  hyperdx_platform: 'string',
  level: 'string',
  parent_span_id: 'string',
  rum_session_id: 'string',
  service: 'string',
  span_id: 'string',
  span_name: 'string',
  trace_id: 'string',
  userEmail: 'string',
  userId: 'string',
  userName: 'string',
};

export const isCustomColumn = (name: string) => customColumnMap[name] != null;

// used by rrweb table
export const buildSearchColumnName_OLD = (
  type: 'string' | 'number' | 'bool',
  name: string,
) => {
  if (customColumnMap[name] != null) {
    return customColumnMap[name];
  }

  return type != null && name != null
    ? `"${type}.values"[indexOf("${type}.names", ${SqlString.escape(name)})]`
    : null;
};

export const buildSearchColumnName = (
  type: 'string' | 'number' | 'bool' | undefined | null,
  name: string,
) => {
  if (customColumnMap[name] != null) {
    return customColumnMap[name];
  }

  if (name != null && type != null) {
    return SqlString.format(`_${type}_attributes[?]`, [name]);
  }

  return null;
};

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

type SQLSerializerOptions = {
  useTokenization: boolean;
};
export class SQLSerializer implements Serializer {
  private NOT_FOUND_QUERY = '(1 = 0)';

  private alreadyRefrehPropertyTypeMapModel = false;

  propertyTypeMapModel: PropertyTypeMappingsModel;

  options: SQLSerializerOptions | undefined;

  constructor(
    propertyTypeMappingsModel: PropertyTypeMappingsModel,
    opts?: SQLSerializerOptions,
  ) {
    this.propertyTypeMapModel = propertyTypeMappingsModel;
    this.options = opts ?? {
      useTokenization: false,
    };
  }

  private getCustomFieldOnly(field: string) {
    return {
      column: customColumnMap[field],
      propertyType: customColumnMapType[field],
      found: customColumnMap[field] != null, // propertyType can be null
    };
  }

  // In the future this may trigger network calls against a property mapping cache
  async getColumnForField(field: string) {
    const customField = this.getCustomFieldOnly(field);
    if (customField.found) {
      return customField;
    }

    let propertyType = this.propertyTypeMapModel.get(field);
    // TODO: Deal with ambiguous fields
    let column: string | null = field;
    // refresh cache if property not found
    if (propertyType == null && !this.alreadyRefrehPropertyTypeMapModel) {
      this.alreadyRefrehPropertyTypeMapModel = true;
      // TODO: what if the property type doesn't exist?
      // we need to setup a cap on how many times we refresh the cache
      await this.propertyTypeMapModel.refresh();
      propertyType = this.propertyTypeMapModel.get(field);
    }

    if (propertyType != null) {
      column = buildSearchColumnName(propertyType, field);
    }

    return {
      column,
      propertyType,
      found: column != null && propertyType != null,
    };
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

  // Only for exact string matches
  async eq(field: string, term: string, isNegatedField: boolean) {
    const { column, found, propertyType } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    if (propertyType === 'bool') {
      // numeric and boolean fields must be equality matched
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= ?)`, [
        normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm),
      ]);
    } else if (propertyType === 'number') {
      return SqlString.format(
        `(${column} ${isNegatedField ? '!' : ''}= CAST(?, 'Float64'))`,
        [term],
      );
    }
    return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= ?)`, [
      term,
    ]);
  }

  async isNotNull(field: string, isNegatedField: boolean) {
    const customField = this.getCustomFieldOnly(field);
    if (customField.found) {
      if (field === 'duration') {
        // Duration will be negative if there is no end_timestamp
        return `_duration ${isNegatedField ? '<' : '>='} 0`;
      }
      if (customField.propertyType === 'string') {
        // Internal string fields are not nullable as long as they are not empty, they're likely not null
        return `notEmpty(${customField.column}) ${
          isNegatedField ? '!' : ''
        }= 1`;
      } else {
        // We'll just try to check for nulls...
        return `${customField.column} IS ${isNegatedField ? '' : 'NOT '}NULL`;
      }
    }

    const { propertyType, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    return SqlString.format(`mapContains(_${propertyType}_attributes, ?) = ?`, [
      field,
      isNegatedField ? 0 : 1,
    ]);
  }

  async gte(field: string, term: string) {
    const { column, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    return SqlString.format(`(${column} >= ?)`, [term]);
  }

  async lte(field: string, term: string) {
    const { column, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    return SqlString.format(`(${column} <= ?)`, [term]);
  }

  async lt(field: string, term: string) {
    const { column, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    return SqlString.format(`(${column} < ?)`, [term]);
  }

  async gt(field: string, term: string) {
    const { column, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
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
    const { column, propertyType, found } = await this.getColumnForField(field);
    if (!found) {
      return this.NOT_FOUND_QUERY;
    }
    // If it's a string field, we will always try to match with ilike

    if (propertyType === 'bool') {
      // numeric and boolean fields must be equality matched
      const normTerm = `${term}`.trim().toLowerCase();
      return SqlString.format(`(${column} ${isNegatedField ? '!' : ''}= ?)`, [
        normTerm === 'true' ? 1 : normTerm === 'false' ? 0 : parseInt(normTerm),
      ]);
    } else if (propertyType === 'number') {
      return SqlString.format(
        `(${column} ${isNegatedField ? '!' : ''}= CAST(?, 'Float64'))`,
        [term],
      );
    }

    if (isImplicitField && this.options?.useTokenization) {
      // For the _source column, we'll try to do whole word searches by default
      // to utilize the token bloom filter unless a prefix/sufix wildcard is specified
      if (prefixWildcard || suffixWildcard) {
        return SqlString.format(
          `(lower(${column}) ${isNegatedField ? 'NOT ' : ''}LIKE lower(?))`,
          [`${prefixWildcard ? '%' : ''}${term}${suffixWildcard ? '%' : ''}`],
        );
      } else {
        // We can't search multiple tokens with `hasToken`, so we need to split up the term into tokens
        const hasSeperators = this.termHasSeperators(term);
        if (hasSeperators) {
          const tokens = this.tokenizeTerm(term);
          return `(${isNegatedField ? 'NOT (' : ''}${[
            ...tokens.map(token =>
              SqlString.format(`hasTokenCaseInsensitive(${column}, ?)`, [
                token,
              ]),
            ),
            // If there are symbols in the term, we'll try to match the whole term as well (ex. Scott!)
            SqlString.format(`(lower(${column}) LIKE lower(?))`, [`%${term}%`]),
          ].join(' AND ')}${isNegatedField ? ')' : ''})`;
        } else {
          return SqlString.format(
            `(${
              isNegatedField ? 'NOT ' : ''
            }hasTokenCaseInsensitive(${column}, ?))`,
            [term],
          );
        }
      }
    } else {
      const shoudUseTokenBf = isImplicitField && isLikelyTokenTerm(term);
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

export async function genWhereSQL(
  ast: lucene.AST,
  propertyTypeMappingsModel: PropertyTypeMappingsModel,
  teamId?: string,
): Promise<string> {
  const serializer = new SQLSerializer(propertyTypeMappingsModel, {
    useTokenization: true,
  });
  return await serialize(ast, serializer);
}

export class SearchQueryBuilder {
  private readonly searchQ: string;

  private readonly conditions: string[];

  private readonly propertyTypeMappingsModel: PropertyTypeMappingsModel;

  teamId?: string;

  constructor(
    searchQ: string,
    propertyTypeMappingsModel: PropertyTypeMappingsModel,
  ) {
    this.conditions = [];
    this.searchQ = searchQ;
    this.propertyTypeMappingsModel = propertyTypeMappingsModel;
  }

  private async genSearchQuery() {
    if (!this.searchQ) {
      return '';
    }

    let querySql = this.searchQ
      .split(/\s+/)
      .map(queryToken =>
        SqlString.format(`lower(_source) LIKE lower(?)`, [`%${queryToken}%`]),
      )
      .join(' AND ');

    try {
      const parsedQ = parse(this.searchQ);

      if (parsedQ) {
        querySql = await genWhereSQL(
          parsedQ,
          this.propertyTypeMappingsModel,
          this.teamId,
        );
      }
    } catch (e) {
      console.warn({
        error: serializeError(e),
        message: 'Parse failure',
        query: this.searchQ,
      });
    }

    return querySql;
  }

  and(condition: string) {
    if (condition && condition.trim()) {
      this.conditions.push(`(${condition})`);
    }
    return this;
  }

  removeInternals() {
    this.and(SqlString.format('notEquals(_platform, ?)', [LogPlatform.Rrweb]));
    return this;
  }

  filterLogsAndSpans() {
    this.and(
      SqlString.format('type = ? OR type = ?', [LogType.Log, LogType.Span]),
    );
    return this;
  }

  static timestampInBetween(startTime: number, endTime: number) {
    return `_timestamp_sort_key >= ${msToBigIntNs(
      startTime,
    )} AND _timestamp_sort_key < ${msToBigIntNs(endTime)}`;
  }

  // startTime and endTime are unix in ms
  timestampInBetween(startTime: number, endTime: number) {
    this.and(SearchQueryBuilder.timestampInBetween(startTime, endTime));
    return this;
  }

  filterLogs() {
    this.and(SqlString.format('type = ?', [LogType.Log]));
    return this;
  }

  filterSpans() {
    this.and(SqlString.format('type = ?', [LogType.Span]));
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

// TODO: replace with a proper query builder
export const buildSearchQueryWhereCondition = async ({
  startTime,
  endTime,
  query,
  propertyTypeMappingsModel,
  teamId,
  type,
}: {
  startTime: number; // unix in ms
  endTime: number; // unix in ms,
  query: string;
  propertyTypeMappingsModel: PropertyTypeMappingsModel;
  teamId?: string;
  type?: 'log' | 'span';
}) => {
  const builder = new SearchQueryBuilder(query, propertyTypeMappingsModel);
  builder.teamId = teamId;
  if (type) {
    if (type === 'log') {
      builder.filterLogs();
    } else if (type === 'span') {
      builder.filterSpans();
    }
  }
  return await builder.timestampInBetween(startTime, endTime).build();
};

export const buildPostGroupWhereCondition = ({ query }: { query: string }) => {
  // This needs to be replaced with the proper query builder
  // after generalizing it for arbitrary field resolutions
  // the query can only specify one field from the series and an exact match
  const [field, value] = query.split(':', 2);
  const seriesNumber = parseInt(field.replace('series_', ''), 10);
  const floatValue = parseFloat(value);

  if (Number.isSafeInteger(seriesNumber) === false) {
    throw new Error('Invalid series number');
  }
  if (Number.isNaN(floatValue)) {
    throw new Error('Invalid value');
  }

  return SqlString.format(`series_${seriesNumber}.data = ?`, [floatValue]);
};
