import lucene from '@hyperdx/lucene';

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

interface Serializer {
  eq(field: string, term: string, isNegatedField: boolean): Promise<string>;
  isNotNull(field: string, isNegatedField: boolean): Promise<string>;
  gte(field: string, term: string): Promise<string>;
  lte(field: string, term: string): Promise<string>;
  lt(field: string, term: string): Promise<string>;
  gt(field: string, term: string): Promise<string>;
  // ilike(field: string, term: string, isNegatedField: boolean): Promise<string>;
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

async function nodeTerm(
  node: lucene.Node,
  serializer: Serializer,
): Promise<string> {
  const field = node.field[0] === '-' ? node.field.slice(1) : node.field;
  let isNegatedField = node.field[0] === '-';
  const isImplicitField = node.field === '<implicit>';

  // TODO: Deal with property with ambiguous/multiple types
  // let propertyType = propertyTypeMap.get(field);

  // const column: string = field;
  // if (customColumnMap[field] != null) {
  //   column = customColumnMap[field];
  //   propertyType = 'string';
  // } else {
  //   if (propertyType != null) {
  //     column = buildSearchColumnName(propertyType, field);
  //   }
  // }

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
      // return SqlString.format(`${column}${isNegatedField ? '!' : ''}=?`, [
      //   term,
      // ]);
    }

    if (!nodeTerm.quoted && term === '*') {
      return serializer.isNotNull(field, isNegatedField);
      // return `${column} IS ${isNegatedField ? '' : 'NOT '}NULL`;
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
      // const fn = isNegatedField ? '>' : '<=';
      // return `${column} ${fn} ${term.slice(2)}`;
    }
    if (!nodeTerm.quoted && term[0] === '>') {
      if (isNegatedField) {
        return serializer.lte(field, term.slice(1));
      }
      return serializer.gt(field, term.slice(1));
      // const fn = isNegatedField ? '<=' : '>';
      // return `${column} ${fn} ${term.slice(1)}`;
    }
    if (!nodeTerm.quoted && term[0] === '<') {
      if (isNegatedField) {
        return serializer.gte(field, term.slice(1));
      }
      return serializer.lt(field, term.slice(1));
      // const fn = isNegatedField ? '>=' : '<';
      // return `${column} ${fn} ${term.slice(1)}`;
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
    // Bool/Numbers need to be matched with equality operator
    // if (
    //   !isImplicitField &&
    //   (propertyType === 'number' || propertyType === 'bool')
    // ) {
    //   return serializer.eq(field, term, isNegatedField);
    //   // return `${column} ${isNegatedField ? '!' : ''}= ${term}`;
    // }

    // TODO: Handle regex, similarity, boost, prefix
    // return serializer.ilike(field, term, isNegatedField);
    // return `(${column} ${isNegatedField ? 'NOT ' : ''}ILIKE '%${term}%')`;
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
    // return `(${column} ${isNegatedField ? 'NOT ' : ''}BETWEEN ${
    //   rangedTerm.term_min
    // } AND ${rangedTerm.term_max})`;
  }

  throw new Error(`Unexpected Node type. ${node}`);
}

async function serialize(
  ast: lucene.AST | lucene.Node,
  serializer: Serializer,
  // propertyTypeMap: Map<string, 'bool' | 'string' | 'number'>,
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
    const operator =
      binaryAST.operator === '<implicit>' ? 'AND' : binaryAST.operator;
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
