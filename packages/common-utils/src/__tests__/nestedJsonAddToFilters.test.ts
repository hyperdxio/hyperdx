import { filtersToQuery } from '@/filters';
import { parse } from '@/queryParser';

/**
 * Regression coverage for the nested-JSON "Add to Filters" crash.
 *
 * "Add to Filters" on an attribute reached through a parsed JSON string column
 * (e.g. `weird.key.payload` holding a JSON string) builds a ClickHouse SQL
 * expression as the filter field: `JSONExtractString(LogAttributes['weird.key
 * .payload'], 'abc.def.jqk/abcd')`. The previous code emitted this as the field
 * side of a Lucene term (`<expr>:"value"`), which `lucene.parse` cannot parse —
 * it opens a range expression at the `[` after `LogAttributes` and throws
 * `SyntaxError: Expected ".", "TO", ... but "]" found.` at chart render time.
 *
 * `filtersToQuery` now detects SQL-expression field keys and emits a SQL filter
 * instead, so the broken Lucene string is never produced.
 */
describe('nested-JSON "Add to Filters" does not produce unparseable Lucene', () => {
  const sqlExprKey =
    "JSONExtractString(LogAttributes['weird.key.payload'], 'abc.def.jqk/abcd')";

  it('locks in the bug: the old Lucene condition throws when parsed', () => {
    // The unescaped `[`/`]`/`(`/`)` make the Lucene PEG parser open a range
    // expression after `LogAttributes` and fail.
    const oldLuceneCondition = `${sqlExprKey}:"asdf-14"`;
    expect(() => parse(oldLuceneCondition)).toThrow();
  });

  it('minimal repro: a bare `field:[term]` (no TO) throws', () => {
    expect(() => parse('key:[foo]')).toThrow();
  });

  it('filtersToQuery now emits a SQL filter (never handed to lucene.parse)', () => {
    const filters = filtersToQuery({
      [sqlExprKey]: {
        included: new Set<string | boolean>(['asdf-14']),
        excluded: new Set<string | boolean>(),
      },
    });

    expect(filters).toEqual([
      { type: 'sql', condition: `${sqlExprKey} IN ('asdf-14')` },
    ]);
  });

  it('any Lucene filter the handler still emits parses successfully', () => {
    // Plain field paths keep using Lucene; whatever Lucene condition the
    // handler emits must parse without throwing.
    const filters = filtersToQuery({
      'LogAttributes.weird.key.payload': {
        included: new Set<string | boolean>(['asdf-14']),
        excluded: new Set<string | boolean>(),
      },
    });

    for (const filter of filters) {
      if (filter.type === 'lucene' && 'condition' in filter) {
        expect(() => parse(filter.condition)).not.toThrow();
      }
    }
  });
});
