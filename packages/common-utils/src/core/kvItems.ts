/** Describes a KV items column and its concat separator */
export type KvItemsInfo = {
  kvItemsColumn: string;
  separator: string;
};

/** Map from map column name to its KV items info */
export type KvItemsLookup = Map<string, KvItemsInfo>;

/**
 * Tokenizes a ClickHouse expression into meaningful tokens (identifiers, parens,
 * commas, arrows, quoted strings, operators). Whitespace is skipped.
 * Returns null if the expression contains unrecognized characters.
 */
function tokenizeExpression(expr: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }
    // Arrow operator ->
    if (expr[i] === '-' && expr[i + 1] === '>') {
      tokens.push('->');
      i += 2;
      continue;
    }
    // Cast operator ::
    if (expr[i] === ':' && expr[i + 1] === ':') {
      tokens.push('::');
      i += 2;
      continue;
    }
    // Single-char tokens
    if ('(),.'.includes(expr[i])) {
      tokens.push(expr[i]);
      i++;
      continue;
    }
    // Quoted string (single or double)
    if (expr[i] === "'" || expr[i] === '"') {
      const quote = expr[i];
      let str = '';
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') {
          str += expr[i + 1] ?? '';
          i += 2;
        } else {
          str += expr[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push(`'${str}'`); // normalize to single-quote wrapper
      continue;
    }
    // Identifier or keyword (word chars)
    if (/\w/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /\w/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      tokens.push(ident);
      continue;
    }
    // Unknown character — return null to signal unparseable expression
    return null;
  }
  return tokens;
}

/**
 * Helper: parses the common arrayMap lambda prefix and concat body, returning the
 * lambda variable name, separator, and remaining token position.
 * Handles both parenthesized `(x) ->` and bare `x ->` lambda parameter forms.
 */
function parseArrayMapConcatPrefix(
  tokens: string[],
): { lambdaVar: string; separator: string; pos: number } | undefined {
  let pos = 0;
  const expect = (expected: string): boolean => {
    if (pos >= tokens.length || tokens[pos] !== expected) return false;
    pos++;
    return true;
  };
  const read = (): string | undefined => tokens[pos++];

  if (!expect('arrayMap') || !expect('(')) return undefined;

  // Lambda param: either (x) -> or x ->
  let lambdaVar: string | undefined;
  if (tokens[pos] === '(') {
    pos++; // skip (
    lambdaVar = read();
    if (!lambdaVar || !expect(')')) return undefined;
  } else {
    lambdaVar = read();
    if (!lambdaVar) return undefined;
  }
  if (!expect('->')) return undefined;

  // concat(lambdaVar.1, '<sep>', lambdaVar.2)
  if (!expect('concat') || !expect('(')) return undefined;
  if (!expect(lambdaVar) || !expect('.') || !expect('1') || !expect(','))
    return undefined;

  const sepToken = read();
  if (!sepToken || !sepToken.startsWith("'") || !expect(',')) return undefined;
  const separator = sepToken.slice(1, -1);

  if (
    !expect(lambdaVar) ||
    !expect('.') ||
    !expect('2') ||
    !expect(')') ||
    !expect(',')
  )
    return undefined;

  return { lambdaVar, separator, pos };
}

/**
 * Parses a KV items column's default_expression to extract the source map column name
 * and the constant separator string used in the concat.
 * Matches the inline-cast form:
 *   arrayMap((arr) -> concat(arr.1, '=', arr.2), X::Array(Tuple(String, String)))
 * Also supports bare lambda param: arrayMap(x -> concat(...), ...)
 * Returns { mapColumn, separator } if the expression matches, otherwise undefined.
 */
export function parseKvItemsExpression(
  defaultExpression: string,
): { mapColumn: string; separator: string } | undefined {
  const tokens = tokenizeExpression(defaultExpression);
  if (!tokens) return undefined;

  const prefix = parseArrayMapConcatPrefix(tokens);
  if (!prefix) return undefined;

  let pos = prefix.pos;
  const expect = (expected: string): boolean => {
    if (pos >= tokens.length || tokens[pos] !== expected) return false;
    pos++;
    return true;
  };
  const read = (): string | undefined => tokens[pos++];

  // X::Array(Tuple(String, String))
  const mapColumn = read();
  if (!mapColumn) return undefined;
  if (
    !expect('::') ||
    !expect('Array') ||
    !expect('(') ||
    !expect('Tuple') ||
    !expect('(') ||
    !expect('String') ||
    !expect(',') ||
    !expect('String') ||
    !expect(')') ||
    !expect(')') ||
    !expect(')')
  )
    return undefined;

  if (pos !== tokens.length) return undefined;

  return { mapColumn, separator: prefix.separator };
}

/**
 * Parses a KV items column's default_expression using the CAST function form:
 *   arrayMap((arr) -> concat(arr.1, '=', arr.2), CAST(X, 'Array(Tuple(String, String))'))
 * Also supports bare lambda param: arrayMap(x -> concat(...), ...)
 * Returns { mapColumn, separator } if the expression matches, otherwise undefined.
 */
export function parseKvItemsCastExpression(
  defaultExpression: string,
): { mapColumn: string; separator: string } | undefined {
  const tokens = tokenizeExpression(defaultExpression);
  if (!tokens) return undefined;

  const prefix = parseArrayMapConcatPrefix(tokens);
  if (!prefix) return undefined;

  let pos = prefix.pos;
  const expect = (expected: string): boolean => {
    if (pos >= tokens.length || tokens[pos] !== expected) return false;
    pos++;
    return true;
  };
  const read = (): string | undefined => tokens[pos++];

  // CAST(X, 'Array(Tuple(String, String))')
  if (!expect('CAST') || !expect('(')) return undefined;
  const mapColumn = read();
  if (!mapColumn || !expect(',')) return undefined;

  // The type argument is a quoted string like 'Array(Tuple(String, String))'
  const typeToken = read();
  if (!typeToken || !typeToken.startsWith("'")) return undefined;
  const typeStr = typeToken.slice(1, -1); // strip quotes
  const normalizedType = typeStr.replace(/\s+/g, '');
  if (normalizedType !== 'Array(Tuple(String,String))') return undefined;

  if (!expect(')') || !expect(')')) return undefined;

  if (pos !== tokens.length) return undefined;

  return { mapColumn, separator: prefix.separator };
}

/**
 * Ordered list of strategies tried by callers when parsing a KV items column's
 * default_expression. To add support for another shape, append a new function
 * with the same signature.
 */
export const KV_ITEMS_STRATEGIES = [
  parseKvItemsExpression,
  parseKvItemsCastExpression,
] as const;

/**
 * Tries each parsing strategy in order and returns the first successful match,
 * or undefined when no strategy recognises the expression.
 */
export function parseKvItemsDefaultExpression(
  defaultExpression: string,
): { mapColumn: string; separator: string } | undefined {
  for (const strategy of KV_ITEMS_STRATEGIES) {
    const parsed = strategy(defaultExpression);
    if (parsed) return parsed;
  }
  return undefined;
}
