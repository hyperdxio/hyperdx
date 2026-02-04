import { validateSelectOnlySql } from '../core/sqlValidator';

describe('sqlValidator', () => {
  describe('validateSelectOnlySql', () => {
    describe('valid SELECT queries', () => {
      it('should accept simple SELECT query', () => {
        const result = validateSelectOnlySql('SELECT * FROM table');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should accept SELECT with columns', () => {
        const result = validateSelectOnlySql(
          'SELECT col1, col2 FROM my_table',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with WHERE clause', () => {
        const result = validateSelectOnlySql(
          "SELECT * FROM logs WHERE level = 'error'",
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with GROUP BY', () => {
        const result = validateSelectOnlySql(
          'SELECT service, count() FROM logs GROUP BY service',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with ORDER BY and LIMIT', () => {
        const result = validateSelectOnlySql(
          'SELECT * FROM table ORDER BY timestamp DESC LIMIT 100',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with subquery', () => {
        const result = validateSelectOnlySql(
          'SELECT * FROM (SELECT * FROM inner_table)',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with CTE (WITH clause)', () => {
        const result = validateSelectOnlySql(
          'WITH cte AS (SELECT * FROM base) SELECT * FROM cte',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with aggregations', () => {
        const result = validateSelectOnlySql(
          'SELECT toStartOfHour(timestamp) as ts, count() as cnt FROM logs GROUP BY ts',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept SELECT with UNION', () => {
        const result = validateSelectOnlySql(
          'SELECT * FROM table1 UNION ALL SELECT * FROM table2',
        );
        expect(result.isValid).toBe(true);
      });

      it('should accept complex SELECT with multiple clauses', () => {
        const result = validateSelectOnlySql(`
          SELECT
            toStartOfInterval(timestamp, INTERVAL 1 HOUR) as time_bucket,
            service,
            count() as event_count
          FROM logs
          WHERE timestamp > now() - INTERVAL 24 HOUR
          GROUP BY time_bucket, service
          HAVING event_count > 10
          ORDER BY time_bucket DESC, event_count DESC
          LIMIT 1000
        `);
        expect(result.isValid).toBe(true);
      });
    });

    describe('invalid/dangerous queries', () => {
      it('should reject DROP statement', () => {
        const result = validateSelectOnlySql('DROP TABLE users');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('DROP');
        expect(result.error).toContain('not allowed');
      });

      it('should reject DELETE statement', () => {
        const result = validateSelectOnlySql('DELETE FROM users WHERE id = 1');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('DELETE');
      });

      it('should reject INSERT statement', () => {
        const result = validateSelectOnlySql(
          "INSERT INTO users (name) VALUES ('test')",
        );
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('INSERT');
      });

      it('should reject UPDATE statement', () => {
        const result = validateSelectOnlySql(
          "UPDATE users SET name = 'test' WHERE id = 1",
        );
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('UPDATE');
      });

      it('should reject ALTER statement', () => {
        const result = validateSelectOnlySql(
          'ALTER TABLE users ADD COLUMN email String',
        );
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('ALTER');
      });

      it('should reject CREATE statement', () => {
        const result = validateSelectOnlySql(
          'CREATE TABLE test (id Int32)',
        );
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('CREATE');
      });

      it('should reject TRUNCATE statement', () => {
        const result = validateSelectOnlySql('TRUNCATE TABLE users');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('TRUNCATE');
      });

      it('should reject case-insensitive dangerous statements', () => {
        const result = validateSelectOnlySql('drop TABLE users');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('DROP');
      });
    });

    describe('edge cases', () => {
      it('should reject empty string', () => {
        const result = validateSelectOnlySql('');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject whitespace-only string', () => {
        const result = validateSelectOnlySql('   ');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should handle ClickHouse-specific syntax (fallback to keyword check)', () => {
        // This uses ClickHouse-specific syntax that may not parse with node-sql-parser
        // but should still be accepted because it starts with SELECT
        const result = validateSelectOnlySql(
          'SELECT toStartOfInterval(timestamp, INTERVAL 1 HOUR) FROM logs SETTINGS max_execution_time=30',
        );
        expect(result.isValid).toBe(true);
      });

      it('should reject SHOW statement', () => {
        const result = validateSelectOnlySql('SHOW DATABASES');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Only SELECT statements are allowed');
      });
    });
  });
});
