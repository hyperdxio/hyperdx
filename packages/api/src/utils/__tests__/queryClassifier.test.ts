import { classifyQuery } from '@/utils/queryClassifier';

describe('classifyQuery', () => {
  it.each([
    ['SELECT * FROM events', 'read'],
    ['SELECT count(*) FROM x', 'read'],
    ['  select id from x', 'read'],
    ['/*c*/ SELECT 1', 'read'],
    ['INSERT INTO events VALUES (1)', 'write'],
    ['UPDATE events SET x=1', 'write'],
    ['DELETE FROM events', 'write'],
    ['MERGE INTO events ...', 'write'],
    ['CREATE TABLE x(...)', 'write'],
    ['DROP TABLE x', 'write'],
    ['ALTER TABLE x ...', 'write'],
    ['TRUNCATE TABLE x', 'write'],
    ['', 'read'],
  ] as const)('classifies %s as %s', (sql, expected) => {
    expect(classifyQuery(sql)).toBe(expected);
  });

  it('treats CTE-with-INSERT as write', () => {
    const sql = 'WITH x AS (SELECT 1) INSERT INTO y SELECT * FROM x';
    expect(classifyQuery(sql)).toBe('write');
  });

  it('ignores keywords inside line comments', () => {
    const sql = '-- INSERT INTO x VALUES (1)\nSELECT 1';
    expect(classifyQuery(sql)).toBe('read');
  });

  it('ignores keywords inside block comments', () => {
    const sql = '/* DELETE FROM x */ SELECT 1';
    expect(classifyQuery(sql)).toBe('read');
  });
});
