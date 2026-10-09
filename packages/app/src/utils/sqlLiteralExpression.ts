/**
 * ClickHouse string literal — `'abc'`, `'it''s'`, `'a\'b'`.
 *
 * The three alternatives are disjoint on their first character, so the repeat
 * has nothing to backtrack into.
 */
const STRING_LITERAL = /^'(?:[^'\\]|\\[\s\S]|'')*'/;

/**
 * ClickHouse number literal — decimal, hex, binary, float, exponent.
 *
 * The trailing lookahead mirrors ClickHouse's lexer: a digit run that continues
 * straight into a letter is a single identifier, not a number followed by
 * something else, so `2643cca9640b…` must not match here. A following `.` is
 * excluded too, so `t.2` stays a qualified reference.
 */
const NUMBER_LITERAL =
  /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)(?![\w.])/;

/** An alias trailing a value: `x`, `AS x`, `` AS `x` ``, `AS "x"`. */
const TRAILING_ALIAS =
  /^(?:as\s+)?(?:[A-Za-z_]\w*|`(?:[^`]|``)+`|"(?:[^"]|"")+")$/i;

/**
 * True when the expression is a hard-coded value rather than something read off
 * the row — a quoted string, a number, or either of those carrying an alias.
 *
 * The alias case is the one that bites in practice. ClickHouse reads
 * `2643 cca9640b1639cb111d28216dd09` as the constant `2643` aliased to
 * `cca9640b1639cb111d28216dd09`, so `EXPLAIN` accepts it and the source form
 * reports the expression as valid; the query only breaks later, when it appends
 * its own alias to a value that already has one.
 *
 * Deliberately conservative: anything with an operator or a function call
 * (`'x' || TraceId`, `toString(1)`) is left alone, because working out whether
 * those reference a column needs a real parser.
 */
export function isLiteralSqlExpression(expression: string): boolean {
  const expr = expression.trim();

  const literal = STRING_LITERAL.exec(expr) ?? NUMBER_LITERAL.exec(expr);
  if (!literal) {
    return false;
  }

  const rest = expr.slice(literal[0].length).trim();

  return rest === '' || TRAILING_ALIAS.test(rest);
}
