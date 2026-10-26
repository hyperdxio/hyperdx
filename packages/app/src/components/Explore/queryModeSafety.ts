export type QueryLanguage = 'sql' | 'lucene';

/**
 * Explore is SQL-only: what you type in the search box is a WHERE clause, which
 * is the same language as the full statement behind the code toggle. That is
 * the whole point of the two coexisting — anything you learn in the box carries
 * over when you open the statement.
 */
export function getDefaultExploreLanguage(): QueryLanguage {
  return 'sql';
}

/**
 * A Lucene WHERE still reaches Explore from a saved search shared with the
 * Search page, an old link, or a side-panel action on a source that defines a
 * Lucene expression for an attribute.
 *
 * It cannot be translated on the way in — `genWhereSQL` needs table metadata
 * and a round trip — so there is nothing to put in the box that the box could
 * then edit. Explore drops it and says so, rather than running a query the
 * search field claims to hold but cannot express.
 */
export function hasUneditableLuceneWhere(
  where: string | null | undefined,
  whereLanguage: string | null | undefined,
): boolean {
  return whereLanguage === 'lucene' && (where ?? '').trim() !== '';
}

/** The WHERE Explore will author, with any Lucene clause discarded. */
export function toSqlWhere(
  where: string | null | undefined,
  whereLanguage: string | null | undefined,
): { where: string; whereLanguage: QueryLanguage } {
  return {
    where: whereLanguage === 'lucene' ? '' : (where ?? ''),
    whereLanguage: 'sql',
  };
}
