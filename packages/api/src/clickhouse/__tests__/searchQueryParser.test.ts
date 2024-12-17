import SqlString from 'sqlstring';

import { LogsPropertyTypeMappingsModel } from '../propertyTypeMappingsModel';
import {
  genWhereSQL,
  msToBigIntNs,
  parse,
  SearchQueryBuilder,
} from '../searchQueryParser';

describe.skip('searchQueryParser', () => {
  describe('helpers', () => {
    it('msToBigIntNs', () => {
      expect(msToBigIntNs(0)).toBe(BigInt(0));
      expect(msToBigIntNs(1000)).toBe(BigInt(1000000000));
    });
  });

  // for implicit field
  function implicitLike(column: string, term: string) {
    return `(lower(${column}) LIKE lower('${term}'))`;
  }

  function implicitLikeSubstring(column: string, term: string) {
    return `(lower(${column}) LIKE lower('%${term}%'))`;
  }

  function like(column: string, term: string) {
    return `(${column} ILIKE '${term}')`;
  }
  function likeSubstring(column: string, term: string) {
    return `(${column} ILIKE '%${term}%')`;
  }
  function nlike(column: string, term: string) {
    return `(${column} NOT ILIKE '%${term}%')`;
  }
  function hasToken(column: string, term: string, noParen = false) {
    return `${noParen ? '' : '('}hasTokenCaseInsensitive(${column}, '${term}')${
      noParen ? '' : ')'
    }`;
  }
  function notHasToken(column: string, term: string) {
    return `(NOT hasTokenCaseInsensitive(${column}, '${term}'))`;
  }
  function eq(column: string, term: string, isExpression = false) {
    return `(${column} = ${isExpression ? '' : "'"}${term}${
      isExpression ? '' : "'"
    })`;
  }
  function neq(column: string, term: string, isExpression = false) {
    return `(${column} != ${isExpression ? '' : "'"}${term}${
      isExpression ? '' : "'"
    })`;
  }
  function range(column: string, min: string, max: string) {
    return `(${column} BETWEEN ${min} AND ${max})`;
  }
  function nrange(column: string, min: string, max: string) {
    return `(${column} NOT BETWEEN ${min} AND ${max})`;
  }
  function buildSearchColumnName(
    type: 'string' | 'number' | 'bool',
    name: string,
  ) {
    return SqlString.format('??', [
      SqlString.format(`_${type}_attributes[?]`, [name]),
    ]);
  }

  const SOURCE_COL = '`_source`';

  let propertyTypesMappingsModel: LogsPropertyTypeMappingsModel;

  beforeEach(() => {
    propertyTypesMappingsModel = new LogsPropertyTypeMappingsModel(
      1,
      'fake team id',
      () => Promise.resolve({}),
    );
    jest
      .spyOn(propertyTypesMappingsModel, 'get')
      .mockReturnValue(undefined as any);
    jest.spyOn(propertyTypesMappingsModel, 'refresh').mockResolvedValue();
  });

  it('SearchQueryBuilder', async () => {
    jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
    const builder = new SearchQueryBuilder(
      'level:info OR level:warn',
      propertyTypesMappingsModel,
    );
    builder.timestampInBetween(
      new Date('2019-01-01').getTime(),
      new Date('2019-01-02').getTime(),
    );
    const query = await builder.build();
    expect(query).toBe(
      "(`_timestamp_sort_key` >= 1546300800000000000 AND `_timestamp_sort_key` < 1546387200000000000) AND ((severity_text ILIKE '%info%') OR (severity_text ILIKE '%warn%'))",
    );
  });

  describe('bare terms', () => {
    it('parses simple bare terms', async () => {
      const ast = parse('foo');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        hasToken(SOURCE_COL, 'foo'),
      );
    });

    it('parses multiple bare terms', async () => {
      const ast = parse('foo bar baz999');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${hasToken(SOURCE_COL, 'foo')} AND ${hasToken(
          SOURCE_COL,
          'bar',
        )} AND ${hasToken(SOURCE_COL, 'baz999')}`,
      );
    });

    it('parses quoted bare terms', async () => {
      const ast = parse('"foo" "bar" baz999');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${hasToken(SOURCE_COL, 'foo')} AND ${hasToken(
          SOURCE_COL,
          'bar',
        )} AND ${hasToken(SOURCE_COL, 'baz999')}`,
      );
    });

    it('parses quoted multi-terms', async () => {
      const ast = parse('"foo bar"');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `(${hasToken(SOURCE_COL, 'foo', true)} AND ${hasToken(
          SOURCE_COL,
          'bar',
          true,
        )} AND ${implicitLikeSubstring(SOURCE_COL, 'foo bar')})`,
      );
    });

    it('parses empty quoted terms', async () => {
      const ast = parse('"foo" bar ""');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${hasToken(SOURCE_COL, 'foo')} AND ${hasToken(
          SOURCE_COL,
          'bar',
        )} AND (1=1)`,
      );
    });

    it('parses bare terms with symbols', async () => {
      const ast = parse('scott!');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `(${hasToken(SOURCE_COL, 'scott', true)} AND ${implicitLikeSubstring(
          SOURCE_COL,
          'scott!',
        )})`,
      );
    });

    it('parses quoted bare terms with symbols', async () => {
      const ast = parse('"scott["');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `(${hasToken(SOURCE_COL, 'scott', true)} AND ${implicitLikeSubstring(
          SOURCE_COL,
          'scott[',
        )})`,
      );
    });

    // TODO: Figure out symbol handling here as well...
    it.skip('does not do comparison operators on quoted bare terms', async () => {
      const ast = parse('"<foo>"');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `(${hasToken(SOURCE_COL, '<foo>')}} AND ${likeSubstring(
          SOURCE_COL,
          '<foo>',
        )})`,
      );
    });

    describe('parentheses', () => {
      it('parses parenthesized bare terms', async () => {
        const ast = parse('foo (bar baz)');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${hasToken(SOURCE_COL, 'foo')} AND (${hasToken(
            SOURCE_COL,
            'bar',
          )} AND ${hasToken(SOURCE_COL, 'baz')})`,
        );
      });

      it('parses parenthesized negated bare terms', async () => {
        const ast = parse('foo (-bar baz)');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${hasToken(SOURCE_COL, 'foo')} AND (${notHasToken(
            SOURCE_COL,
            'bar',
          )} AND ${hasToken(SOURCE_COL, 'baz')})`,
        );
      });
    });

    describe('negation', () => {
      it('negates bare terms', async () => {
        const ast = parse('-bar');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${notHasToken(SOURCE_COL, 'bar')}`,
        );
      });

      it('negates quoted bare terms', async () => {
        const ast = parse('-"bar baz"');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `(NOT (${hasToken(SOURCE_COL, 'bar', true)} AND ${hasToken(
            SOURCE_COL,
            'baz',
            true,
          )} AND ${implicitLikeSubstring(SOURCE_COL, 'bar baz')}))`,
        );
      });

      it('matches negated and non-negated bare terms', async () => {
        const ast = parse('foo -bar baz -qux');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${hasToken(SOURCE_COL, 'foo')} AND ${notHasToken(
            SOURCE_COL,
            'bar',
          )} AND ${hasToken(SOURCE_COL, 'baz')} AND ${notHasToken(
            SOURCE_COL,
            'qux',
          )}`,
        );
      });
    });

    describe('wildcards', () => {
      it('allows wildcard prefix and postfix', async () => {
        const ast = parse('*foo*');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${implicitLike(SOURCE_COL, '%foo%')}`,
        );
      });

      it('does not parse * in the middle of terms', async () => {
        const ast = parse('ff*oo*');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${implicitLike(SOURCE_COL, 'ff*oo%')}`,
        );
      });

      // TODO: Handle this
      it.skip('does not parse * in quoted terms', async () => {
        const ast = parse('"*foobar baz"');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${hasToken(SOURCE_COL, '*foo*bar baz')}`,
        );
      });
    });
  });

  describe('operators', () => {
    (
      [
        ['OR', 'OR'],
        ['||', 'OR'],
        ['AND', 'AND'],
        ['&&', 'AND'],
        [' ', 'AND'],
        ['NOT', 'AND NOT'],
        ['AND NOT', 'AND NOT'],
        ['OR NOT', 'OR NOT'],
      ] as const
    ).forEach(([operator, sql]) => {
      it(`parses ${operator}`, async () => {
        const ast = parse(`foo ${operator} bar`);
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${hasToken(SOURCE_COL, 'foo')} ${sql} ${hasToken(
            SOURCE_COL,
            'bar',
          )}`,
        );
      });
    });
  });

  describe('properties', () => {
    it('parses string property values', async () => {
      const ast = parse('foo:bar');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        likeSubstring("_string_attributes['foo']", 'bar'),
      );
    });

    it('parses bool property values', async () => {
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('bool');
      const ast = parse('bool_foo:1');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(buildSearchColumnName('bool', 'bool_foo'), '1', true)}`,
      );
    });

    it('parses text-based false bool property values', async () => {
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('bool');
      console.log('types??', propertyTypesMappingsModel.get('blah'));
      const ast = parse('bool_foo:false');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(buildSearchColumnName('bool', 'bool_foo'), '0', true)}`,
      );
    });

    it('parses text-based true bool property values', async () => {
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('bool');
      const ast = parse('bool_foo:true');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(buildSearchColumnName('bool', 'bool_foo'), '1', true)}`,
      );
    });

    it('parses text-based non-normalized true bool property values', async () => {
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('bool');
      const ast = parse('bool_foo:TrUe');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(buildSearchColumnName('bool', 'bool_foo'), '1', true)}`,
      );
    });

    it('parses text-based exact true bool property values', async () => {
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('bool');
      const ast = parse('bool_foo:"TrUe"');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(buildSearchColumnName('bool', 'bool_foo'), '1', true)}`,
      );
    });

    it('parses numeric property values', async () => {
      const ast = parse('foo:123');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('number');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${eq(
          buildSearchColumnName('number', 'foo'),
          "CAST('123', 'Float64')",
          true,
        )}`,
      );
    });

    it('parses hex property values', async () => {
      const ast = parse('foo:0fa1b0ba');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        likeSubstring("_string_attributes['foo']", '0fa1b0ba'),
      );
    });

    it('parses quoted property values', async () => {
      const ast = parse('foo:"blah:foo http://website"');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        eq("_string_attributes['foo']", 'blah:foo http://website'),
      );
    });

    it('parses bare terms combined with property values', async () => {
      const ast = parse('bar foo:0f');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${hasToken(SOURCE_COL, 'bar')} AND ${likeSubstring(
          "_string_attributes['foo']",
          '0f',
        )}`,
      );
    });

    it('parses ranges of values', async () => {
      const ast = parse('foo:[400 TO 599]');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${range("_string_attributes['foo']", '400', '599')}`,
      );
    });

    it('parses numeric properties', async () => {
      const ast = parse('5:info');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${likeSubstring("_string_attributes['5']", 'info')}`,
      );
    });

    it('translates custom column mapping', async () => {
      const ast = parse('level:info');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        `${likeSubstring('severity_text', 'info')}`,
      );
    });

    it('handle non-existent property', async () => {
      const ast = parse('foo:bar');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        '(1 = 0)',
      );
    });

    it('parses escaped quotes in quoted searches', async () => {
      const ast = parse('foo:"b\\"ar"');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        eq("_string_attributes['foo']", 'b\\"ar'),
      );
    });

    it('parses backslash literals', async () => {
      const ast = parse('foo:"b\\\\ar"');
      jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
      expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
        eq("_string_attributes['foo']", 'b\\\\ar'),
      );
    });

    it('does not escape quotes with backslash literals', async () => {
      expect(() => parse('foo:"b\\\\"ar"')).toThrowErrorMatchingInlineSnapshot(
        `"Expected \\"\\\\\\"\\", \\"\\\\\\\\\\", or any character but end of input found."`,
      );
    });

    // FIXME: enable this
    describe.skip('negation', () => {
      it('negates property values', async () => {
        const ast = parse('-foo:bar');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${nlike(buildSearchColumnName('string', 'foo'), 'bar')}`,
        );
      });

      it('supports negated negative property string values', async () => {
        const ast = parse('-foo:-bar');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${nlike(buildSearchColumnName('string', 'foo'), '-bar')}`,
        );
      });

      it('supports negated negative property number values', async () => {
        const ast = parse('-foo:-5');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('number');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${neq(
            buildSearchColumnName('number', 'foo'),
            "CAST('-5', 'Float64')",
            true,
          )}`,
        );
      });

      it('supports negating numeric properties', async () => {
        const ast = parse('-5:info');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${nlike(buildSearchColumnName('string', '5'), 'info')}`,
        );
      });

      it('supports negating numeric properties with negative values', async () => {
        const ast = parse('-5:-150');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('number');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${neq(
            buildSearchColumnName('number', '5'),
            "CAST('-150', 'Float64')",
            true,
          )}`,
        );
      });

      it('negates ranges of values', async () => {
        const ast = parse('-5:[-100 TO -500]');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${nrange(buildSearchColumnName('string', '5'), '-100', '-500')}`,
        );
      });

      it('negates quoted searches', async () => {
        const ast = parse('-foo:"bar"');
        jest.spyOn(propertyTypesMappingsModel, 'get').mockReturnValue('string');
        expect(await genWhereSQL(ast, propertyTypesMappingsModel)).toEqual(
          `${neq(buildSearchColumnName('string', 'foo'), 'bar')}`,
        );
      });
    });
  });
});
