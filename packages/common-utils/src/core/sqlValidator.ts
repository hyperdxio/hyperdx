import * as SQLParser from 'node-sql-parser';

export interface SqlValidationResult {
  isValid: boolean;
  error?: string;
}

const DISALLOWED_STATEMENT_TYPES = new Set([
  'drop',
  'delete',
  'insert',
  'update',
  'alter',
  'create',
  'truncate',
  'replace',
  'grant',
  'revoke',
  'set',
  'use',
  'kill',
  'attach',
  'detach',
  'rename',
  'optimize',
  'system',
]);

/**
 * Validates that SQL is a SELECT-only statement.
 * Rejects DROP, DELETE, INSERT, UPDATE, ALTER, CREATE, TRUNCATE, etc.
 *
 * @param sql The SQL string to validate
 * @returns SqlValidationResult with isValid flag and optional error message
 */
export function validateSelectOnlySql(sql: string): SqlValidationResult {
  if (!sql || sql.trim() === '') {
    return { isValid: false, error: 'SQL query is empty' };
  }

  const parser = new SQLParser.Parser();

  try {
    // Parse the SQL to extract the AST
    // Using PostgreSQL dialect as it's closest to ClickHouse SQL
    const ast = parser.astify(sql, { database: 'Postgresql' });

    // AST can be an array if multiple statements are present
    const statements = Array.isArray(ast) ? ast : [ast];

    if (statements.length === 0) {
      return { isValid: false, error: 'No valid SQL statement found' };
    }

    // Check each statement
    for (const statement of statements) {
      if (!statement || typeof statement !== 'object') {
        return { isValid: false, error: 'Invalid SQL statement' };
      }

      const stmtType = statement.type?.toLowerCase();

      if (!stmtType) {
        return { isValid: false, error: 'Unable to determine statement type' };
      }

      if (stmtType !== 'select') {
        if (DISALLOWED_STATEMENT_TYPES.has(stmtType)) {
          return {
            isValid: false,
            error: `${stmtType.toUpperCase()} statements are not allowed. Only SELECT queries are permitted.`,
          };
        }

        return {
          isValid: false,
          error: `Only SELECT statements are allowed. Found: ${stmtType.toUpperCase()}`,
        };
      }
    }

    return { isValid: true };
  } catch (e) {
    // If parsing fails, the SQL might have syntax errors
    // or use ClickHouse-specific syntax not supported by the parser.
    // We'll do a simple keyword check as a fallback.
    const sqlUpper = sql.trim().toUpperCase();
    const firstWord = sqlUpper.split(/\s+/)[0];

    // Check if it starts with a disallowed keyword
    if (DISALLOWED_STATEMENT_TYPES.has(firstWord.toLowerCase())) {
      return {
        isValid: false,
        error: `${firstWord} statements are not allowed. Only SELECT queries are permitted.`,
      };
    }

    // If it doesn't start with SELECT or WITH (CTEs), it's likely not a valid query
    if (!['SELECT', 'WITH'].includes(firstWord)) {
      return {
        isValid: false,
        error: `Query must start with SELECT or WITH. Found: ${firstWord}`,
      };
    }

    // Accept it if it starts with SELECT/WITH - ClickHouse syntax may not parse
    return { isValid: true };
  }
}
