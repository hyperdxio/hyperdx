/**
 * SQL read/write classifier used by the Berg query gate.
 *
 * In v1 the API only accepts read queries; any write (DML/DDL) is rejected
 * with `forbidden_write` before it reaches Athena.  Phase 2 will use the
 * same classifier to route writes through a separate, audited path.
 *
 * The classifier is deliberately lexical and conservative: it strips SQL
 * comments and looks for any write keyword as a whole word.  A CTE that
 * embeds an `INSERT` (`WITH x AS (...) INSERT INTO y SELECT * FROM x`) is
 * still classified as a write, which is the correct outcome.
 */

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke)\b/i;

export function classifyQuery(sql: string): 'read' | 'write' {
  if (!sql) return 'read';
  // Strip block + line comments and leading/trailing whitespace before
  // matching, so a write keyword inside a comment doesn't cause a false
  // rejection.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
  return WRITE_KEYWORDS.test(stripped) ? 'write' : 'read';
}
