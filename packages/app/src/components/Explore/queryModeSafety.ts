export type QueryLanguage = 'sql' | 'lucene';

/**
 * Explore is SQL-only: what you type in the search box is a WHERE clause, which
 * is the same language as the full statement behind the code toggle. That is
 * the whole point of the two coexisting — anything you learn in the box carries
 * over when you open the statement.
 *
 * Lucene is still *rendered* when a saved search or a shared link carries it,
 * so older searches keep working; there is just no way to author it here.
 */
export function getDefaultExploreLanguage(): QueryLanguage {
  return 'sql';
}
