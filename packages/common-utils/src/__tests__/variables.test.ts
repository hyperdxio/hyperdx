import {
  MacroExpansionError,
  MalformedMacroArgsError,
  UnknownVariableError,
} from '@/macroErrors';
import type { BuilderChartConfig, ChartVariable } from '@/types';
import {
  filterReferencedVariables,
  formatVariableValues,
  getAlertVariableWarning,
  getReferencedVariableNames,
  getVariableReferences,
  hasVariableMacro,
  substituteChartConfigVariables,
  substitutePromqlChartConfigVariables,
  substituteVariables,
  validateVariableReferencesInTemplate,
  VariableContext,
} from '@/variables';

const variable = (
  name: string,
  values: string[],
  expression?: string,
): ChartVariable => ({ name, values, expression });

/**
 * `substituteWithContext` with the SQL-ish defaults, so each case only spells
 * out the part of the context it is exercising.
 */
const substituteVariablesSql = (
  input: string,
  variables: ChartVariable[],
  overrides: Partial<Omit<VariableContext, 'variables'>> = {},
) =>
  substituteVariables(input, {
    variables,
    inputLanguage: 'sql',
    ...overrides,
  });

const SERVICE = variable('service', ['api', 'web'], 'ServiceName');
const EMPTY_SERVICE = variable('service', [], 'ServiceName');

const builderConfig = (
  overrides: Partial<BuilderChartConfig> = {},
): BuilderChartConfig => ({
  select: 'count()',
  from: { databaseName: 'default', tableName: 'logs' },
  where: '',
  whereLanguage: 'sql',
  timestampValueExpression: 'Timestamp',
  connection: 'local',
  ...overrides,
});

describe('formatVariableValues', () => {
  describe('sqlstring', () => {
    it('renders NULL when nothing is selected', () => {
      expect(formatVariableValues([], 'sqlstring')).toBe('NULL');
    });

    it('renders a single quoted value', () => {
      expect(formatVariableValues(['api'], 'sqlstring')).toBe("'api'");
    });

    it('renders a comma-separated list', () => {
      expect(formatVariableValues(['api', 'web'], 'sqlstring')).toBe(
        "'api', 'web'",
      );
    });

    it('escapes quotes and backslashes the same way the broadcast path does', () => {
      expect(formatVariableValues(["o'brien", 'a\\b'], 'sqlstring')).toBe(
        "'o''brien', 'a\\\\b'",
      );
    });
  });

  describe('regex', () => {
    it('matches anything when nothing is selected', () => {
      expect(formatVariableValues([], 'regex')).toBe('.*');
    });

    it('leaves a single value unwrapped', () => {
      expect(formatVariableValues(['api'], 'regex')).toBe('api');
    });

    it('wraps an alternation of multiple values', () => {
      expect(formatVariableValues(['api', 'web'], 'regex')).toBe('(api|web)');
    });

    it('escapes regex metacharacters', () => {
      expect(formatVariableValues(['a.b+c', 'x(y)'], 'regex')).toBe(
        '(a\\.b\\+c|x\\(y\\))',
      );
    });
  });

  describe('csv', () => {
    it('renders empty when nothing is selected', () => {
      expect(formatVariableValues([], 'csv')).toBe('');
    });

    it('joins values with commas', () => {
      expect(formatVariableValues(['api', 'web'], 'csv')).toBe('api,web');
    });
  });

  describe('lucene', () => {
    it('renders an empty term when nothing is selected', () => {
      // Parenthesized so it stays a no-op in a field-scoped position; see the
      // queryParser test that pins `ServiceName:("")` to `1=1`.
      expect(formatVariableValues([], 'lucene')).toBe('("")');
    });

    it('renders a single quoted term', () => {
      expect(formatVariableValues(['api'], 'lucene')).toBe('("api")');
    });

    it('ORs multiple terms', () => {
      expect(formatVariableValues(['api', 'web'], 'lucene')).toBe(
        '("api" OR "web")',
      );
    });

    it('escapes backslashes and double quotes', () => {
      expect(formatVariableValues(['a"b', 'c\\d'], 'lucene')).toBe(
        '("a\\"b" OR "c\\\\d")',
      );
    });
  });
});

describe('substituteVariables', () => {
  describe('bare references', () => {
    it('substitutes with the sqlstring format by default', () => {
      expect(
        substituteVariablesSql('WHERE ServiceName IN ($service)', [SERVICE]),
      ).toBe("WHERE ServiceName IN ('api', 'web')");
    });

    it('substitutes NULL when nothing is selected', () => {
      expect(
        substituteVariablesSql('WHERE ServiceName IN ($service)', [
          EMPTY_SERVICE,
        ]),
      ).toBe('WHERE ServiceName IN (NULL)');
    });

    it('leaves an unknown name verbatim', () => {
      expect(substituteVariablesSql("SELECT '$notAVariable'", [SERVICE])).toBe(
        "SELECT '$notAVariable'",
      );
    });

    it('matches names maximally so a longer name is not partially replaced', () => {
      expect(substituteVariablesSql('$service_name', [SERVICE])).toBe(
        '$service_name',
      );
      expect(
        substituteVariablesSql('$service_name', [
          SERVICE,
          variable('service_name', ['checkout']),
        ]),
      ).toBe("'checkout'");
    });

    it('leaves a lone $ and $-digit sequences alone', () => {
      expect(substituteVariablesSql('SELECT $, $1, x$', [SERVICE])).toBe(
        'SELECT $, $1, x$',
      );
    });

    it("applies the language's default format", () => {
      expect(
        substituteVariables('{service="$service"}', {
          variables: [SERVICE],
          inputLanguage: 'promql',
        }),
      ).toBe('{service="(api|web)"}');
    });
  });

  describe('inputLanguage', () => {
    it('turns on the lucene handling when the input is lucene', () => {
      expect(
        substituteVariables('ServiceName:"$service"', {
          variables: [SERVICE],
          inputLanguage: 'lucene',
        }),
      ).toBe('(ServiceName:"api" OR ServiceName:"web")');
      expect(
        substituteVariables('$__filter(ServiceName, $service)', {
          variables: [SERVICE],
          inputLanguage: 'lucene',
        }),
      ).toBe('$__filter(ServiceName, $service)');
    });

    it('leaves a reference asking for another format alone in lucene input', () => {
      // The rewrite is per-reference: it only applies where the values would
      // render as lucene terms in the first place.
      expect(
        substituteVariables('ServiceName:"${service:csv}"', {
          variables: [SERVICE],
          inputLanguage: 'lucene',
        }),
      ).toBe('ServiceName:"api,web"');
    });
  });

  describe('braced references', () => {
    it('substitutes ${name} with the default format', () => {
      expect(substituteVariablesSql('${service}', [SERVICE])).toBe(
        "'api', 'web'",
      );
    });

    it.each([
      ['sqlstring', "'api', 'web'"],
      ['regex', '(api|web)'],
      ['csv', 'api,web'],
      ['lucene', '("api" OR "web")'],
    ])('substitutes ${name:%s}', (format, expected) => {
      expect(substituteVariablesSql(`\${service:${format}}`, [SERVICE])).toBe(
        expected,
      );
    });

    it('leaves an unknown name verbatim, format and all', () => {
      expect(substituteVariablesSql('${other:csv}', [SERVICE])).toBe(
        '${other:csv}',
      );
    });

    it('throws on an unknown format for a known name', () => {
      expect(() =>
        substituteVariablesSql('${service:json}', [SERVICE]),
      ).toThrow("Unknown variable format 'json'");
    });

    it('leaves a malformed brace expression as plain text', () => {
      expect(substituteVariablesSql('${not a name}', [SERVICE])).toBe(
        '${not a name}',
      );
      expect(substituteVariablesSql('${service', [SERVICE])).toBe('${service');
    });
  });

  describe('$__filter', () => {
    it('expands the two-argument form against the given expression', () => {
      expect(
        substituteVariablesSql('WHERE $__filter(ServiceName, $service)', [
          SERVICE,
        ]),
      ).toBe("WHERE (ServiceName IN ('api', 'web'))");
    });

    it('expands the one-argument form using the variable expression', () => {
      expect(
        substituteVariablesSql('WHERE $__filter($service)', [SERVICE]),
      ).toBe("WHERE (toString(ServiceName) IN ('api', 'web'))");
    });

    it('rejects a name argument written without its $', () => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter(ServiceName, service)', [
          SERVICE,
        ]),
      ).toThrow(
        "Macro '$__filter' requires its variable argument to be written as a " +
          "reference, as in $__filter(<expression>, $service) — got 'service'.",
      );
    });

    it('rejects a bare name in the one-argument form too', () => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter(service)', [SERVICE]),
      ).toThrow('as in $__filter($service)');
    });

    it('rejects a braced name argument', () => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter(ServiceName, ${service})', [
          SERVICE,
        ]),
      ).toThrow("as in $__filter(<expression>, $name) — got '${service}'");
    });

    it('expands to a no-op predicate when nothing is selected', () => {
      expect(
        substituteVariablesSql('WHERE $__filter(ServiceName, $service)', [
          EMPTY_SERVICE,
        ]),
      ).toBe("WHERE (1=1 /** no values selected for variable 'service' */)");
    });

    it('substitutes references nested in the expression argument', () => {
      expect(
        substituteVariablesSql(
          "WHERE $__filter(concat(col, '$env'), $service)",
          [SERVICE, variable('env', ['prod'])],
        ),
      ).toBe("WHERE (concat(col, ''prod'') IN ('api', 'web'))");
    });

    it('throws when the named variable does not exist', () => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter(ServiceName, $nope)', [
          SERVICE,
        ]),
      ).toThrow("Macro '$__filter' references unknown variable 'nope'");
    });

    it('throws a typed UnknownVariableError carrying the name and the declared set', () => {
      // Callers outside this package react to this specific failure (the MCP
      // tools attach a "declare the filter as a variable" hint to it), and
      // must not have to match on the message to recognize it.
      expect.assertions(5);
      try {
        substituteVariables('WHERE $__filter(ServiceName, $nope)', {
          variables: [SERVICE, variable('env', ['prod'])],
          inputLanguage: 'sql',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownVariableError);
        // Still a MacroExpansionError, so existing handling keeps working.
        expect(e).toBeInstanceOf(MacroExpansionError);
        const error = e as UnknownVariableError;
        expect(error.macro).toBe('filter');
        expect(error.variableName).toBe('nope');
        expect(error.availableVariables).toEqual(['service', 'env']);
      }
    });

    it('reports an empty declared set rather than omitting the field', () => {
      expect.assertions(1);
      try {
        substituteVariables('WHERE $__conditionalAll(1=1, $nope)', {
          variables: [],
          inputLanguage: 'sql',
        });
      } catch (e) {
        expect((e as UnknownVariableError).availableVariables).toEqual([]);
      }
    });

    it('throws on the one-argument form when the variable has no expression', () => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter($service)', [
          variable('service', ['api']),
        ]),
      ).toThrow("Macro '$__filter($service)' requires the variable's filter");
    });

    it('throws on a bad argument count', () => {
      expect(() =>
        substituteVariablesSql('$__filter(a, b, $c)', [SERVICE]),
      ).toThrow("Macro 'filter' expects 1-2 argument(s), but got 3");
    });
  });

  describe('$__conditionalAll', () => {
    it('emits the condition when values are selected', () => {
      expect(
        substituteVariables(
          "WHERE $__conditionalAll(ServiceName = 'api', $service)",
          { variables: [SERVICE], inputLanguage: 'sql' },
        ),
      ).toBe("WHERE (ServiceName = 'api')");
    });

    it('emits a no-op predicate when nothing is selected', () => {
      expect(
        substituteVariablesSql(
          "WHERE $__conditionalAll(ServiceName = 'api', $service)",
          [EMPTY_SERVICE],
        ),
      ).toBe("WHERE (1=1 /** no values selected for variable 'service' */)");
    });

    it('substitutes references inside the condition', () => {
      expect(
        substituteVariablesSql(
          'WHERE $__conditionalAll(ServiceName IN ($service), $service)',
          [SERVICE],
        ),
      ).toBe("WHERE (ServiceName IN ('api', 'web'))");
    });

    it('rejects a name argument written without its $', () => {
      expect(() =>
        substituteVariablesSql(
          "WHERE $__conditionalAll(ServiceName = 'api', service)",
          [SERVICE],
        ),
      ).toThrow(
        "Macro '$__conditionalAll' requires its variable argument to be written " +
          "as a reference, as in $__conditionalAll(<condition>, $service) — got 'service'.",
      );
    });

    it('expands a variable macro nested in the condition', () => {
      expect(
        substituteVariablesSql(
          'WHERE $__conditionalAll(NOT $__filter(ServiceName, $service), $env)',
          [SERVICE, variable('env', ['prod'])],
        ),
      ).toBe("WHERE (NOT (ServiceName IN ('api', 'web')))");
    });

    it('expands a nested reference exactly once', () => {
      expect(
        substituteVariablesSql('$__conditionalAll(col = $a, $service)', [
          SERVICE,
          variable('a', ['$service']),
        ]),
      ).toBe("(col = '$service')");
    });

    it('throws when the named variable does not exist', () => {
      expect(() =>
        substituteVariablesSql('$__conditionalAll(x = 1, $nope)', [SERVICE]),
      ).toThrow("Macro '$__conditionalAll' references unknown variable 'nope'");
    });

    it('throws on a bad argument count', () => {
      expect(() =>
        substituteVariablesSql('$__conditionalAll(x = 1)', [SERVICE]),
      ).toThrow("Macro 'conditionalAll' expects 2 argument(s), but got 1");
    });
  });

  describe('argument parsing', () => {
    it('handles a close paren inside a quoted argument', () => {
      expect(
        substituteVariablesSql("$__conditionalAll(col = 'a)b', $service)", [
          SERVICE,
        ]),
      ).toBe("(col = 'a)b')");
    });

    it('handles an open paren and a comma inside a quoted argument', () => {
      expect(
        substituteVariablesSql("$__conditionalAll(col = 'a,(b', $service)", [
          SERVICE,
        ]),
      ).toBe("(col = 'a,(b')");
    });

    it('handles nested parens in the condition', () => {
      expect(
        substituteVariablesSql(
          '$__conditionalAll(has(splitByChar(:, col), 1), $service)',
          [SERVICE],
        ),
      ).toBe('(has(splitByChar(:, col), 1))');
    });

    it('throws when the argument list is never closed', () => {
      expect(() =>
        substituteVariablesSql('$__filter(ServiceName, service', [SERVICE]),
      ).toThrow(MalformedMacroArgsError);
    });
  });

  it('does not re-expand values that themselves look like references', () => {
    expect(
      substituteVariablesSql('$a $b', [
        variable('a', ['$b']),
        variable('b', ['literal']),
      ]),
    ).toBe("'$b' 'literal'");
  });

  it('leaves non-variable macros untouched', () => {
    expect(
      substituteVariablesSql('WHERE $__timeFilter(ts) AND $__filters', [
        SERVICE,
      ]),
    ).toBe('WHERE $__timeFilter(ts) AND $__filters');
  });

  it('substitutes a reference written inside a non-variable macro, which is only text here', () => {
    // Standard macros exist in the raw SQL path (`replaceMacros`) alone, so
    // there is no argument to recurse into — the reference is plain text.
    expect(
      substituteVariablesSql('WHERE $__timeFilter(${service:csv})', [SERVICE]),
    ).toBe('WHERE $__timeFilter(api,web)');
  });

  it('does not treat $__filters as the $__filter macro', () => {
    expect(substituteVariablesSql('$__filters', [SERVICE])).toBe('$__filters');
  });
});

describe('substituteVariables per language', () => {
  it('expands references as SQL strings and macros as predicates for sql', () => {
    expect(
      substituteVariables(
        'ServiceName IN ($service) AND $__filter(ServiceName, $service)',
        { variables: [SERVICE], inputLanguage: 'sql' },
      ),
    ).toBe("ServiceName IN ('api', 'web') AND (ServiceName IN ('api', 'web'))");
  });

  it('expands references in the lucene format for lucene', () => {
    expect(
      substituteVariables('ServiceName:$service', {
        variables: [SERVICE],
        inputLanguage: 'lucene',
      }),
    ).toBe('ServiceName:("api" OR "web")');
  });

  it('leaves macros as written in a lucene expression', () => {
    expect(
      substituteVariables('$__filter(ServiceName, $service)', {
        variables: [SERVICE],
        inputLanguage: 'lucene',
      }),
    ).toBe('$__filter(ServiceName, $service)');
  });

  it('renders an empty selection in each language', () => {
    expect(
      substituteVariables('ServiceName IN ($service)', {
        variables: [EMPTY_SERVICE],
        inputLanguage: 'sql',
      }),
    ).toBe('ServiceName IN (NULL)');
    expect(
      substituteVariables('ServiceName:$service', {
        variables: [EMPTY_SERVICE],
        inputLanguage: 'lucene',
      }),
    ).toBe('ServiceName:("")');
    expect(
      substituteVariables('up{service=~"$service"}', {
        variables: [EMPTY_SERVICE],
        inputLanguage: 'promql',
      }),
    ).toBe('up{service=~".*"}');
  });

  describe('quoted references expand to exact matches', () => {
    // Quoting a reference is how an author opts into matching each selected
    // value exactly: the lucene→SQL layer compiles `field:"a"` as equality,
    // where a group-internal `("a")` becomes a substring match. The distributed
    // shapes below are pinned end-to-end in queryParser.test.ts.
    const expand = (template: string, variables: ChartVariable[] = [SERVICE]) =>
      substituteVariables(template, { variables, inputLanguage: 'lucene' });

    it('is opt-in: quoting distributes the field, leaving it grouped does not', () => {
      expect(expand('ServiceName:"$service"')).toBe(
        '(ServiceName:"api" OR ServiceName:"web")',
      );
      expect(expand('ServiceName:$service')).toBe(
        'ServiceName:("api" OR "web")',
      );
    });

    it('distributes over a single value', () => {
      expect(
        expand('ServiceName:"$service"', [variable('service', ['api'])]),
      ).toBe('(ServiceName:"api")');
    });

    it('distributes across the whitespace the grammar allows after the colon', () => {
      // `ServiceName: "$service"` parses to the same AST as the unspaced form
      // — same field, same term — so it has to expand the same way.
      expect(expand('ServiceName: "$service"')).toBe(
        '(ServiceName:"api" OR ServiceName:"web")',
      );
      expect(expand('SeverityText:error AND ServiceName:  "$service"')).toBe(
        'SeverityText:error AND (ServiceName:"api" OR ServiceName:"web")',
      );
    });

    it('distributes over a dotted field', () => {
      expect(expand('LogAttributes.service:"$service"')).toBe(
        '(LogAttributes.service:"api" OR LogAttributes.service:"web")',
      );
    });

    it('distributes over a Map key and a JSON path', () => {
      // Both are just dotted fields to the grammar, so the field repeats
      // verbatim per value. queryParser.test.ts pins what each compiles to —
      // notably that a Map key keeps its `indexHint(mapContains(...))` on every
      // distributed term.
      expect(expand('LogAttributes.error.message:"$service"')).toBe(
        '(LogAttributes.error.message:"api" OR LogAttributes.error.message:"web")',
      );
      expect(expand('ResourceAttributesJSON.error.message:"$service"')).toBe(
        '(ResourceAttributesJSON.error.message:"api" OR ResourceAttributesJSON.error.message:"web")',
      );
    });

    it('distributes over a Map key holding a value that needs escaping', () => {
      expect(
        expand('LogAttributes.k8s.pod.name:"$service"', [
          variable('service', ['pod-a"1', 'pod\\b']),
        ]),
      ).toBe(
        '(LogAttributes.k8s.pod.name:"pod-a\\"1" OR LogAttributes.k8s.pod.name:"pod\\\\b")',
      );
    });

    it('keeps the no-op form for a Map key and a JSON path with no selection', () => {
      expect(
        expand('LogAttributes.error.message:"$service"', [EMPTY_SERVICE]),
      ).toBe('LogAttributes.error.message:("")');
      expect(
        expand('ResourceAttributesJSON.error.message:"$service"', [
          EMPTY_SERVICE,
        ]),
      ).toBe('ResourceAttributesJSON.error.message:("")');
    });

    it('distributes over a field with an escaped colon', () => {
      expect(expand('foo\\:bar:"$service"')).toBe(
        '(foo\\:bar:"api" OR foo\\:bar:"web")',
      );
    });

    it('escapes each value through the distributed path', () => {
      expect(
        expand('ServiceName:"$service"', [variable('service', ['a"b'])]),
      ).toBe('(ServiceName:"a\\"b")');
    });

    it('distributes every quoted reference in a template', () => {
      expect(
        expand('ServiceName:"$service" AND Env:"$env"', [
          SERVICE,
          variable('env', ['prod']),
        ]),
      ).toBe('(ServiceName:"api" OR ServiceName:"web") AND (Env:"prod")');
    });

    it('keeps the surrounding parentheses of a wrapped reference', () => {
      expect(expand('(ServiceName:"$service")')).toBe(
        '((ServiceName:"api" OR ServiceName:"web"))',
      );
    });

    it('turns a `-` negated reference into NOT, which the grammar can parse', () => {
      // The fork parses `-field:x` with the `-` inside the field name, and
      // `-(...)` is not a shape the grammar accepts.
      expect(expand('-ServiceName:"$service"')).toBe(
        'NOT (ServiceName:"api" OR ServiceName:"web")',
      );
      expect(expand('SeverityText:error AND -ServiceName:"$service"')).toBe(
        'SeverityText:error AND NOT (ServiceName:"api" OR ServiceName:"web")',
      );
    });

    it('leaves a spelled-out NOT in the text', () => {
      expect(expand('NOT ServiceName:"$service"')).toBe(
        'NOT (ServiceName:"api" OR ServiceName:"web")',
      );
    });

    it('keeps the grouped no-op form for an empty selection', () => {
      // `field:("")` compiles to `1=1`; a distributed `field:""` would compare
      // the column against the empty string instead. The quotes are consumed
      // either way, so the quoted spelling is safe before anything is selected.
      expect(expand('ServiceName:"$service"', [EMPTY_SERVICE])).toBe(
        'ServiceName:("")',
      );
      expect(expand('-ServiceName:"$service"', [EMPTY_SERVICE])).toBe(
        '-ServiceName:("")',
      );
      expect(expand('ServiceName:$service', [EMPTY_SERVICE])).toBe(
        'ServiceName:("")',
      );
    });

    it('leaves a reference embedded in a longer phrase alone', () => {
      // The phrase is more than the reference, so it is a phrase match rather
      // than a selection.
      expect(expand('ServiceName:"$service down"')).toBe(
        'ServiceName:"("api" OR "web") down"',
      );
    });

    it('leaves a bare reference grouped, since it has no field', () => {
      expect(expand('$service')).toBe('("api" OR "web")');
    });

    it('leaves an unfielded quoted reference alone', () => {
      // Nothing to distribute the values over.
      expect(expand('"$service"')).toBe('"("api" OR "web")"');
    });

    it('leaves an already grouped reference alone', () => {
      // The inner term parses with an implicit field, so there is no field on
      // it to distribute.
      expect(expand('ServiceName:("$service")')).toBe(
        'ServiceName:("("api" OR "web")")',
      );
    });

    it('leaves a reference that asked for another format alone', () => {
      expect(expand('ServiceName:"${service:csv}"')).toBe(
        'ServiceName:"api,web"',
      );
    });

    it('leaves an unknown name verbatim', () => {
      expect(expand('ServiceName:"$unknown"')).toBe('ServiceName:"$unknown"');
    });

    it('falls back to the plain expansion when the template will not parse', () => {
      expect(expand('(ServiceName:"$service"')).toBe(
        '(ServiceName:"("api" OR "web")"',
      );
    });

    // `http://` and friends only parse after `encodeSpecialTokens`, which
    // this preprocessor applies the same way the renderer does. The special
    // text must round-trip verbatim wherever it sits relative to the
    // reference.
    it.each([
      [
        'Url:http://example.com AND ServiceName:"$service"',
        'Url:http://example.com AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'ServiceName:"$service" AND Url:http://example.com',
        '(ServiceName:"api" OR ServiceName:"web") AND Url:http://example.com',
      ],
      [
        'http://example.com AND ServiceName:"$service"',
        'http://example.com AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'Url:https://a.example AND ServiceName:"$service" AND Referrer:https://b.example',
        'Url:https://a.example AND (ServiceName:"api" OR ServiceName:"web") AND Referrer:https://b.example',
      ],
      [
        'Host:localhost:3000 AND ServiceName:"$service"',
        'Host:localhost:3000 AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'Url:http://localhost:8080 AND ServiceName:"$service"',
        'Url:http://localhost:8080 AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'Body:path\\\\to AND ServiceName:"$service"',
        'Body:path\\\\to AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'foo\\:bar:baz AND ServiceName:"$service"',
        'foo\\:bar:baz AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'Url:http://example.com AND foo\\:bar:"$service"',
        'Url:http://example.com AND (foo\\:bar:"api" OR foo\\:bar:"web")',
      ],
      [
        '-foo\\:bar:"$service" AND Url:https://example.com',
        'NOT (foo\\:bar:"api" OR foo\\:bar:"web") AND Url:https://example.com',
      ],
      [
        'ServiceName:"$service" AND Url:http://example.com AND Env:"$env"',
        '(ServiceName:"api" OR ServiceName:"web") AND Url:http://example.com AND (Env:"prod")',
      ],
      [
        'Message:"see https://example.com/docs" AND ServiceName:"$service"',
        'Message:"see https://example.com/docs" AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        '(Url:http://a.example OR Url:https://b.example) AND ServiceName:"$service"',
        '(Url:http://a.example OR Url:https://b.example) AND (ServiceName:"api" OR ServiceName:"web")',
      ],
      [
        'ServiceName:"$service" AND Body:a\\\\b AND foo\\:bar:x AND Host:localhost:9000',
        '(ServiceName:"api" OR ServiceName:"web") AND Body:a\\\\b AND foo\\:bar:x AND Host:localhost:9000',
      ],
    ])('distributes within `%s`', (template, expected) => {
      expect(expand(template, [SERVICE, variable('env', ['prod'])])).toBe(
        expected,
      );
    });

    it('keeps the no-op form for an escaped-colon field with no selection', () => {
      expect(expand('foo\\:bar:"$service"', [EMPTY_SERVICE])).toBe(
        'foo\\:bar:("")',
      );
    });

    it('never distributes over a field that is itself a reference', () => {
      // `$field:"$service"` parses with the *placeholder* standing in for the
      // field, so rewriting would splice that placeholder into the output.
      expect(
        expand('$field:"$service"', [
          variable('field', ['ServiceName']),
          SERVICE,
        ]),
      ).toBe('("ServiceName"):"("api" OR "web")"');
    });
  });
});

describe('substituteVariables for promql', () => {
  const promql = (input: string, variables: ChartVariable[]) =>
    substituteVariables(input, { variables, inputLanguage: 'promql' });

  /** `up{service=~"…"}` with `service` selecting the given values. */
  const matcher = (values: string[]) =>
    promql('up{service=~"$service"}', [variable('service', values)]);

  describe('escaping a value for the matcher it sits in', () => {
    it('matches anything when nothing is selected, so the tile stays valid', () => {
      expect(matcher([])).toBe('up{service=~".*"}');
    });

    it('emits a single value as-is', () => {
      expect(matcher(['api'])).toBe('up{service=~"api"}');
    });

    it('emits an alternation for several values', () => {
      expect(matcher(['api', 'web'])).toBe('up{service=~"(api|web)"}');
    });

    it('double-escapes a regex metacharacter for the string literal around it', () => {
      // `v1\.2` in the RE2 pattern, so it matches `v1.2` and not `v1x2`.
      expect(matcher(['v1.2'])).toBe('up{service=~"v1\\\\.2"}');
    });

    it('escapes a double quote with a single backslash, unlike Grafana', () => {
      // `\\"` would close the PromQL string literal early.
      expect(matcher(['a"b'])).toBe('up{service=~"a\\"b"}');
    });

    it('escapes a backslash twice over — once as a regex, once as a string', () => {
      // Value `a\b` -> pattern `a\\b` -> literal `a\\\\b`.
      expect(matcher(['a\\b'])).toBe('up{service=~"a\\\\\\\\b"}');
    });

    it("leaves ' alone, which is not an RE2 metacharacter and invalid to escape here", () => {
      expect(matcher(["o'brien"])).toBe('up{service=~"o\'brien"}');
    });

    it('handles a value needing every layer at once', () => {
      expect(matcher(['a."b\\c', 'web'])).toBe(
        'up{service=~"(a\\\\.\\"b\\\\\\\\c|web)"}',
      );
    });
  });

  describe('behaviour', () => {
    it('uses the regex format for an unformatted reference', () => {
      expect(promql('${service}', [SERVICE])).toBe('(api|web)');
      expect(promql('$service', [SERVICE])).toBe('(api|web)');
    });

    it('still honours an explicitly requested format', () => {
      expect(promql('${service:csv}', [SERVICE])).toBe('api,web');
      expect(promql('${service:sqlstring}', [SERVICE])).toBe("'api', 'web'");
    });

    it('leaves the variable macros exactly as written, arguments and all', () => {
      expect(promql('$__filter(ServiceName, $service)', [SERVICE])).toBe(
        '$__filter(ServiceName, $service)',
      );
      expect(promql('$__conditionalAll(x == 1, $service)', [SERVICE])).toBe(
        '$__conditionalAll(x == 1, $service)',
      );
    });

    it('leaves an unknown name verbatim', () => {
      expect(promql('up{service=~"$nope"}', [SERVICE])).toBe(
        'up{service=~"$nope"}',
      );
    });

    it('does not substitute inside a # comment', () => {
      expect(promql('# see $service\nup', [SERVICE])).toBe(
        '# see $service\nup',
      );
    });

    it('does not re-expand a selected value that looks like a reference', () => {
      expect(
        promql('$a $b', [variable('a', ['$b']), variable('b', ['literal'])]),
      ).toBe('\\\\$b literal');
    });
  });
});

describe('substituteVariables regex escaping for sql', () => {
  const sqlMatch = (values: string[]) =>
    substituteVariables("match(x, '${service:regex}')", {
      variables: [variable('service', values)],
      inputLanguage: 'sql',
    });

  it('leaves an ordinary alternation byte-identical', () => {
    expect(sqlMatch(['api', 'web'])).toBe("match(x, '(api|web)')");
  });

  it("doubles the regex escape so ClickHouse's literal parser keeps it", () => {
    // Before: `'a\.b'`, where CH drops the unknown escape and `a.b` matches `axb`.
    expect(sqlMatch(['a.b'])).toBe("match(x, 'a\\\\.b')");
  });

  it('escapes a single quote, which used to end the literal early', () => {
    expect(sqlMatch(["a'b"])).toBe("match(x, 'a''b')");
  });

  it('escapes a backslash so the pattern gets a literal one', () => {
    expect(sqlMatch(['a\\b'])).toBe("match(x, 'a\\\\\\\\b')");
  });

  it('renders the empty selection as an unconstrained pattern', () => {
    expect(sqlMatch([])).toBe("match(x, '.*')");
  });
});

describe('substituteVariables formats the language must not re-escape', () => {
  it.each(['sql', 'promql'] as const)(
    'leaves the sqlstring format self-quoted in %s',
    language => {
      expect(
        substituteVariables('${service:sqlstring}', {
          variables: [SERVICE],
          inputLanguage: language,
        }),
      ).toBe("'api', 'web'");
    },
  );

  it.each(['sql', 'promql'] as const)(
    'keeps the csv format raw in %s, since it carries identifiers',
    language => {
      expect(
        substituteVariables('${service:csv}', {
          variables: [variable('service', ["a'b.c"])],
          inputLanguage: language,
        }),
      ).toBe("a'b.c");
    },
  );
});

describe('getVariableReferences', () => {
  it('returns an empty list for a template with no references', () => {
    expect(getVariableReferences('SELECT 1 FROM t')).toEqual([]);
  });

  it('reports every occurrence, in source order, with its written form', () => {
    expect(getVariableReferences('$zulu ${alpha:csv} $zulu')).toEqual([
      { name: 'zulu', kind: 'bare', inStringLiteral: false, raw: '$zulu' },
      {
        name: 'alpha',
        kind: 'braced',
        format: 'csv',
        inStringLiteral: false,
        raw: '${alpha:csv}',
      },
      { name: 'zulu', kind: 'bare', inStringLiteral: false, raw: '$zulu' },
    ]);
  });

  it('reports the macro forms under the name they filter by', () => {
    expect(
      getVariableReferences(
        '$__filter(ServiceName, $service) $__conditionalAll(x = 1, $region)',
      ),
    ).toEqual([
      {
        name: 'service',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__filter',
      },
      {
        name: 'region',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__conditionalAll',
      },
    ]);
  });

  it('drops a macro name argument that is not a valid variable name', () => {
    expect(getVariableReferences('$__filter(ServiceName, ${service})')).toEqual(
      [],
    );
  });

  it('still reads a name argument missing its $, which expansion rejects', () => {
    // Detection stays lenient so we can show helpful warnings when the $ is missing before the variable
    expect(getVariableReferences('$__filter(ServiceName, service)')).toEqual([
      {
        name: 'service',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__filter',
      },
    ]);
  });

  it('flags a reference inside a single-quoted string', () => {
    expect(getVariableReferences("WHERE name = '$service'")).toEqual([
      { name: 'service', kind: 'bare', inStringLiteral: true, raw: '$service' },
    ]);
  });

  it('flags a reference inside a LIKE pattern', () => {
    expect(getVariableReferences("WHERE name LIKE '%$service%'")).toEqual([
      { name: 'service', kind: 'bare', inStringLiteral: true, raw: '$service' },
    ]);
  });

  it('does not flag a reference after a closed string literal', () => {
    expect(getVariableReferences("WHERE a = 'x' AND b = $service")).toEqual([
      {
        name: 'service',
        kind: 'bare',
        inStringLiteral: false,
        raw: '$service',
      },
    ]);
  });

  describe('comments', () => {
    const bareRef = (inStringLiteral: boolean) => [
      { name: 'service', kind: 'bare', inStringLiteral, raw: '$service' },
    ];

    it.each([
      ['a hash line comment', "# don't\nWHERE a IN ($service)"],
      ['a line comment', "-- don't\nWHERE a IN ($service)"],
      ['a block comment', "/* don't */ WHERE a IN ($service)"],
      ['a trailing line comment', "WHERE a IN ($service) -- don't"],
    ])('does not let an apostrophe in %s open a string', (_label, input) => {
      expect(getVariableReferences(input)).toEqual(bareRef(false));
    });

    it('still flags a genuinely quoted reference after such a comment', () => {
      expect(getVariableReferences("-- don't\nWHERE a = '$service'")).toEqual(
        bareRef(true),
      );
    });

    it.each([
      ['--', "SELECT 'a -- b', $service"],
      ['#', "SELECT 'a # b', $service"],
    ])(
      'does not treat %s inside a string literal as a comment',
      (_l, input) => {
        expect(getVariableReferences(input)).toEqual(bareRef(false));
      },
    );

    it('treats an unterminated block comment as running to the end', () => {
      expect(getVariableReferences("SELECT 1 /* don't $service")).toEqual([]);
    });

    it('leaves a reference inside a comment unsubstituted', () => {
      expect(
        substituteVariables('-- see $service\nSELECT 1', {
          variables: [SERVICE],
          inputLanguage: 'sql',
        }),
      ).toBe('-- see $service\nSELECT 1');
      expect(
        substituteVariables('/* $service */ SELECT 1', {
          variables: [SERVICE],
          inputLanguage: 'sql',
        }),
      ).toBe('/* $service */ SELECT 1');
    });

    it('substitutes normally after a comment ends', () => {
      expect(
        substituteVariables('-- see $service\nWHERE a IN ($service)', {
          variables: [SERVICE],
          inputLanguage: 'sql',
        }),
      ).toBe("-- see $service\nWHERE a IN ('api', 'web')");
    });
  });

  it('recovers its quote state when a macro argument list has a stray quote', () => {
    // The scanner jumps over a balanced argument list, so a stray quote inside
    // one must not be skipped: findBalancedParens fails, and the text is
    // rescanned character by character instead.
    expect(getVariableReferences("$__filter(a', b) $service")).toEqual([
      { name: 'service', kind: 'bare', inStringLiteral: true, raw: '$service' },
    ]);
  });

  it('ignores a quote that is escaped with a backslash', () => {
    expect(
      getVariableReferences("WHERE a = 'it\\'s' AND b = $service"),
    ).toEqual([
      {
        name: 'service',
        kind: 'bare',
        inStringLiteral: false,
        raw: '$service',
      },
    ]);
  });

  it('tracks quotes inside a macro expression argument independently', () => {
    expect(
      getVariableReferences("$__filter(concat(col, '$env'), $service)"),
    ).toEqual([
      {
        name: 'service',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__filter',
      },
      {
        name: 'env',
        kind: 'bare',
        inStringLiteral: true,
        guardedBy: 'service',
        raw: '$env',
      },
    ]);
  });

  it('marks a reference in a macro expression as guarded by that macro', () => {
    expect(
      getVariableReferences('$__conditionalAll(ServiceName IN ($svc), $svc)'),
    ).toEqual([
      {
        name: 'svc',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__conditionalAll',
      },
      {
        name: 'svc',
        kind: 'bare',
        inStringLiteral: false,
        guardedBy: 'svc',
        raw: '$svc',
      },
    ]);
  });

  it('leaves a reference outside any macro unguarded', () => {
    expect(
      getVariableReferences('WHERE a IN ($svc) AND $__filter(b, $other)'),
    ).toEqual([
      { name: 'svc', kind: 'bare', inStringLiteral: false, raw: '$svc' },
      {
        name: 'other',
        kind: 'macro',
        inStringLiteral: false,
        raw: '$__filter',
      },
    ]);
  });

  it('does not throw on a malformed macro and still finds later references', () => {
    expect(
      getVariableReferences('$__filter(ServiceName, service $region'),
    ).toEqual([
      { name: 'region', kind: 'bare', inStringLiteral: false, raw: '$region' },
    ]);
  });
});

describe('hasVariableMacro', () => {
  it('is true for either variable macro', () => {
    expect(hasVariableMacro('WHERE $__filter(ServiceName, $service)')).toBe(
      true,
    );
    expect(hasVariableMacro('WHERE $__conditionalAll(x = 1, $region)')).toBe(
      true,
    );
  });

  it('is false for the plural broadcast macro', () => {
    expect(hasVariableMacro('WHERE $__filters')).toBe(false);
  });

  it('is false for a bare reference', () => {
    expect(hasVariableMacro('WHERE ServiceName IN ($service)')).toBe(false);
  });

  it('does not throw on a malformed macro', () => {
    expect(hasVariableMacro('WHERE $__filter(ServiceName, service')).toBe(
      false,
    );
  });
});

describe('getReferencedVariableNames', () => {
  it('returns an empty list for a template with no references', () => {
    expect(getReferencedVariableNames('SELECT 1 FROM t')).toEqual([]);
  });

  it('collects bare and braced references in first-encounter order', () => {
    expect(
      getReferencedVariableNames('$zulu ${alpha:csv} $zulu ${bravo}'),
    ).toEqual(['zulu', 'alpha', 'bravo']);
  });

  it('collects the name argument of both variable macros', () => {
    expect(
      getReferencedVariableNames(
        '$__filter(ServiceName, $service) $__filter($env) $__conditionalAll(x = 1, $region)',
      ),
    ).toEqual(['service', 'env', 'region']);
  });

  it('collects references nested inside macro expression arguments', () => {
    expect(
      getReferencedVariableNames(
        '$__conditionalAll(ServiceName IN ($service), $region)',
      ),
    ).toEqual(['region', 'service']);
  });

  it('accepts $-decorated name arguments', () => {
    expect(getReferencedVariableNames('$__filter(col, $service)')).toEqual([
      'service',
    ]);
  });

  it('does not collect a braced name argument', () => {
    expect(getReferencedVariableNames('$__filter(col, ${service})')).toEqual(
      [],
    );
  });

  it('ignores standard macros and their arguments', () => {
    expect(
      getReferencedVariableNames(
        'SELECT $__timeInterval(ts) FROM $__sourceTable(gauge) WHERE $__filters',
      ),
    ).toEqual([]);
  });

  it('does not throw on a malformed macro and still finds later references', () => {
    expect(getReferencedVariableNames('$__filter(col, service $env')).toEqual([
      'env',
    ]);
  });
});

describe('filterReferencedVariables', () => {
  const variables = [
    SERVICE,
    variable('env', ['prod']),
    variable('region', []),
  ];

  const rawSqlConfig = (sqlTemplate: string) =>
    ({ configType: 'sql', sqlTemplate, connection: 'local' }) as const;

  it('keeps only the referenced variables, in the input order', () => {
    expect(
      filterReferencedVariables(
        rawSqlConfig(
          'WHERE $__filter(RegionName, $region) AND ServiceName = $service',
        ),
        variables,
      ),
    ).toEqual([SERVICE, variable('region', [])]);
  });

  it('returns an empty array when the template references none of them', () => {
    expect(
      filterReferencedVariables(
        rawSqlConfig('SELECT 1 WHERE $__filters'),
        variables,
      ),
    ).toEqual([]);
  });

  it('ignores references to variables that do not exist', () => {
    expect(filterReferencedVariables(rawSqlConfig('$nope'), variables)).toEqual(
      [],
    );
  });

  it('keeps the variables a PromQL expression references', () => {
    expect(
      filterReferencedVariables(
        {
          configType: 'promql',
          promqlExpression: 'up{service=~"$service"}',
          connection: 'local',
        },
        variables,
      ),
    ).toEqual([SERVICE]);
  });

  it('keeps the variables a builder config references, across every expression field', () => {
    expect(
      filterReferencedVariables(
        builderConfig({
          select: [
            { aggFn: 'count', valueExpression: '', aggCondition: '$service' },
          ],
          where: '',
          having: 'count() > 0',
          groupBy: [{ valueExpression: '$__filter(RegionName, $region)' }],
          orderBy: [{ valueExpression: '$env', ordering: 'DESC' }],
        }),
        variables,
      ),
    ).toEqual(variables);
  });

  it('returns an empty array when a builder config references none of them', () => {
    expect(
      filterReferencedVariables(
        builderConfig({ where: 'ServiceName = $nope' }),
        variables,
      ),
    ).toEqual([]);
  });
});

describe('getAlertVariableWarning', () => {
  const variables = [SERVICE, variable('env', ['prod'])];

  const rawSqlConfig = (sqlTemplate: string) =>
    ({ configType: 'sql', sqlTemplate, connection: 'local' }) as const;

  it('says nothing when no variables are in scope', () => {
    const config = rawSqlConfig('WHERE ServiceName = $service');
    expect(getAlertVariableWarning(config, undefined)).toBeUndefined();
    expect(getAlertVariableWarning(config, [])).toBeUndefined();
  });

  it('says nothing when the query references none of them', () => {
    expect(
      getAlertVariableWarning(rawSqlConfig('SELECT 1'), variables),
    ).toBeUndefined();
    expect(
      getAlertVariableWarning(builderConfig({ where: '' }), variables),
    ).toBeUndefined();
  });

  // Unreachable in practice — PromQL displays don't support alerts at all — but
  // the warning is produced from the same reference walk as every other config.
  it('names the variables a PromQL expression references', () => {
    expect(
      getAlertVariableWarning(
        {
          configType: 'promql',
          promqlExpression: 'up{service=~"$service"}',
          connection: 'local',
        },
        variables,
      ),
    ).toBe(
      'This tile references $service. Alerts run with every dashboard variable ' +
        'in its empty state, not the values selected here.',
    );
  });

  it('names only the variables the raw SQL references', () => {
    expect(
      getAlertVariableWarning(
        rawSqlConfig('WHERE ServiceName = $service AND $nope'),
        variables,
      ),
    ).toBe(
      'This tile references $service. Alerts run with every dashboard variable ' +
        'in its empty state, not the values selected here.',
    );
  });

  it('names every variable a builder config references, across its expressions', () => {
    expect(
      getAlertVariableWarning(
        builderConfig({
          select: [
            { aggFn: 'count', valueExpression: '', aggCondition: '$env' },
          ],
          where: '$__filter(ServiceName, $service)',
        }),
        variables,
      ),
    ).toBe(
      'This tile references $service, $env. Alerts run with every dashboard ' +
        'variable in its empty state, not the values selected here.',
    );
  });
});

describe('substituteChartConfigVariables', () => {
  it('returns the config untouched when there is no variable context', () => {
    const config = builderConfig({ where: 'ServiceName = $service' });
    expect(substituteChartConfigVariables(config)).toBe(config);
  });

  it('expands references in where and having, and consumes the variables', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: 'ServiceName IN ($service)',
          having: 'anyLast(Env) = $env',
          variables: [SERVICE, variable('env', ['prod'])],
        }),
      ),
    ).toMatchObject({
      where: "ServiceName IN ('api', 'web')",
      having: "anyLast(Env) = 'prod'",
      variables: undefined,
    });
  });

  it('expands a lucene where clause using the lucene format', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: 'ServiceName:$service',
          whereLanguage: 'lucene',
          variables: [SERVICE],
        }),
      ).where,
    ).toBe('ServiceName:("api" OR "web")');
  });

  it('renders an empty lucene selection as a term that drops out', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: 'ServiceName:$service',
          whereLanguage: 'lucene',
          variables: [EMPTY_SERVICE],
        }),
      ).where,
    ).toBe('ServiceName:("")');
  });

  it('leaves the variable macros alone in a lucene expression', () => {
    // They expand to SQL, which a Lucene parser cannot read, so they are not
    // supported there — and an unknown variable must not throw either.
    const template =
      '$__filter(ServiceName, $service) $__conditionalAll(a, $foo)';
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: template,
          whereLanguage: 'lucene',
          variables: [SERVICE],
        }),
      ).where,
    ).toBe(template);
  });

  it('still expands the macros in a lucene chart’s SQL-language fields', () => {
    // whereLanguage only governs `where`; `having` is SQL regardless.
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: '',
          whereLanguage: 'lucene',
          having: '$__filter(ServiceName, $service)',
          variables: [SERVICE],
        }),
      ).having,
    ).toBe("(ServiceName IN ('api', 'web'))");
  });

  it('expands select value expressions and agg conditions', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          select: [
            {
              aggFn: 'count',
              valueExpression: '',
              // aggCondition defaults to lucene, like the renderer
              aggCondition: 'ServiceName:$service',
            },
            {
              valueExpression: 'countIf(ServiceName IN ($service))',
            },
          ],
          variables: [SERVICE],
        }),
      ).select,
    ).toEqual([
      {
        aggFn: 'count',
        valueExpression: '',
        aggCondition: 'ServiceName:("api" OR "web")',
      },
      { valueExpression: "countIf(ServiceName IN ('api', 'web'))" },
    ]);
  });

  it('expands group by and order by, in both their string and list forms', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          groupBy: '$__conditionalAll(ServiceName, $service)',
          orderBy: [{ valueExpression: '$service', ordering: 'ASC' }],
          variables: [SERVICE],
        }),
      ),
    ).toMatchObject({
      groupBy: '(ServiceName)',
      orderBy: [{ valueExpression: "'api', 'web'", ordering: 'ASC' }],
    });
  });

  it('leaves the non-variable macros alone', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: '$__timeFilter(Timestamp) AND ServiceName IN ($service)',
          variables: [SERVICE],
        }),
      ).where,
    ).toBe("$__timeFilter(Timestamp) AND ServiceName IN ('api', 'web')");
  });

  it('never re-scans an expansion, so a selected value cannot inject a reference', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: 'ServiceName IN ($service)',
          variables: [variable('service', ['$env']), variable('env', ['prod'])],
        }),
      ).where,
    ).toBe("ServiceName IN ('$env')");
  });

  it('renders an empty selection so the query stays valid', () => {
    expect(
      substituteChartConfigVariables(
        builderConfig({
          where: '$__filter(ServiceName, $service)',
          variables: [EMPTY_SERVICE],
        }),
      ).where,
    ).toBe("(1=1 /** no values selected for variable 'service' */)");
  });
});

describe('substitutePromqlChartConfigVariables', () => {
  const promqlConfig = (
    promqlExpression: string,
    variables?: ChartVariable[],
  ) => ({
    configType: 'promql' as const,
    promqlExpression,
    connection: 'local',
    variables,
  });

  it('returns the config untouched when there is no variable context', () => {
    const config = promqlConfig('up{service=~"$service"}');
    expect(substitutePromqlChartConfigVariables(config)).toBe(config);
  });

  it('expands the expression and consumes the variables', () => {
    expect(
      substitutePromqlChartConfigVariables(
        promqlConfig('up{service=~"$service"}', [SERVICE]),
      ),
    ).toMatchObject({
      promqlExpression: 'up{service=~"(api|web)"}',
      variables: undefined,
    });
  });

  it('renders an empty selection as an unconstrained matcher', () => {
    expect(
      substitutePromqlChartConfigVariables(
        promqlConfig('up{service=~"$service"}', [EMPTY_SERVICE]),
      ).promqlExpression,
    ).toBe('up{service=~".*"}');
  });
});

describe('validateVariableReferencesInTemplate', () => {
  const validate = validateVariableReferencesInTemplate;

  it('says nothing about an expression with no references', () => {
    expect(validate("ServiceName = 'api'", [SERVICE])).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('warns about a reference to a variable that does not exist', () => {
    const { errors, warnings } = validate('ServiceName IN ($srvice)', [
      SERVICE,
      variable('env', ['prod']),
    ]);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'SQL references unknown variable $srvice. Available variables: service, env.',
    ]);
  });

  it('lists the available variables as (none) when a dashboard declares none', () => {
    expect(validate('ServiceName IN ($service)', []).warnings).toEqual([
      'SQL references unknown variable $service. Available variables: (none).',
    ]);
  });

  it('names each unknown reference once, as written', () => {
    expect(validate('$a = ${a} AND ${b:csv} = 1', [SERVICE]).warnings).toEqual([
      'SQL references unknown variable $a, ${a}, ${b:csv}. Available variables: service.',
    ]);
  });

  it('takes the sentence subject from the caller', () => {
    expect(
      validate('ServiceName IN ($srvice)', [SERVICE], {
        subject: 'This expression',
      }).warnings,
    ).toEqual([
      'This expression references unknown variable $srvice. Available variables: service.',
    ]);
  });

  it('errors when a sqlstring reference is wrapped in quotes', () => {
    const { errors } = validate("ServiceName = '$service'", [SERVICE]);

    expect(errors).toEqual([
      '$service is wrapped in quotes, but the default sqlstring format already quotes each value. Did you mean to use $__filter(<expression>, $service) or ${service:csv} instead?',
    ]);
  });

  it('warns that a bare reference renders as NULL before anything is selected', () => {
    const { errors, warnings } = validate('ServiceName IN ($service)', [
      SERVICE,
    ]);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      '$service has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, $service) or $__conditionalAll(<condition>, $service) so the query stays valid when no values are selected.',
    ]);
  });

  it('accepts a reference guarded by its own variable macro', () => {
    expect(
      validate('$__filter(ServiceName IN ($service), $service)', [SERVICE]),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a format that has a valid empty state', () => {
    expect(validate('match(ServiceName, ${service:regex})', [SERVICE])).toEqual(
      { errors: [], warnings: [] },
    );
  });

  describe('what a macro refuses to expand', () => {
    it('reports a variable argument written without its $', () => {
      // The message every input shows, not just the raw SQL editor: a builder
      // expression is expanded at query time, long after it is typed.
      expect(validate('$__filter(ServiceName, service)', [SERVICE])).toEqual({
        errors: [
          "Macro '$__filter' requires its variable argument to be written as a " +
            "reference, as in $__filter(<expression>, $service) — got 'service'.",
        ],
        warnings: [],
      });
    });

    it('reports an unknown variable', () => {
      expect(
        validate('$__conditionalAll(x = 1, $nope)', [SERVICE]).errors,
      ).toEqual([
        "Macro '$__conditionalAll' references unknown variable 'nope'. Available variables: service.",
      ]);
    });

    it('reports a bad argument count', () => {
      expect(validate('$__conditionalAll(x = 1)', [SERVICE]).errors).toEqual([
        "Macro 'conditionalAll' expects 2 argument(s), but got 1",
      ]);
    });

    it('says nothing about a macro whose argument list is still being typed', () => {
      // The `$service` inside still draws its usual warning — this is only
      // about not calling a half-typed macro an error.
      expect(
        validate('$__filter(ServiceName, $service', [SERVICE]).errors,
      ).toEqual([]);
    });

    it('says nothing about a macro that expands cleanly', () => {
      expect(validate('$__filter(ServiceName, $service)', [SERVICE])).toEqual({
        errors: [],
        warnings: [],
      });
    });

    it('reports only the Lucene error there, where no macro expands at all', () => {
      const { warnings } = validate(
        '$__filter(ServiceName, service)',
        [SERVICE],
        {
          language: 'lucene',
        },
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('has no meaning in a Lucene expression');
    });
  });

  describe('a reference in a macro argument', () => {
    const TS_COL = variable('tsCol', ['Timestamp']);

    it('warns about the bare form, which expands to a quoted value', () => {
      expect(
        validate('WHERE $__timeFilter($tsCol)', [TS_COL]).warnings,
      ).toEqual([
        '$tsCol has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, $tsCol) or $__conditionalAll(<condition>, $tsCol) so the query stays valid when no values are selected.',
      ]);
    });

    it('says nothing about the csv form, which expands to the column itself', () => {
      expect(validate('WHERE $__timeFilter(${tsCol:csv})', [TS_COL])).toEqual({
        errors: [],
        warnings: [],
      });
    });
  });

  describe('with no variable context at all', () => {
    it('errors on a macro, which can only have been meant as one', () => {
      expect(validate('$__filter(ServiceName, $service)', undefined)).toEqual({
        errors: ['SQL uses $__filter, but no variables are available here.'],
        warnings: [],
      });
    });

    it('only warns on a value reference, which may be literal text', () => {
      expect(validate('ServiceName IN ($service)', undefined)).toEqual({
        errors: [],
        warnings: [
          'SQL references $service, but no variables are available here.',
        ],
      });
    });

    it('reports a macro whose name argument is missing its $ just the same', () => {
      // Expansion never runs here, so this message is the only one the user
      // gets — it has to survive a name argument written the old way.
      expect(validate('$__filter(ServiceName, service)', undefined)).toEqual({
        errors: ['SQL uses $__filter, but no variables are available here.'],
        warnings: [],
      });
    });
  });

  describe('a Lucene expression', () => {
    it('still warns about a reference to a variable that does not exist', () => {
      expect(
        validate('ServiceName:$srvice', [SERVICE], { language: 'lucene' })
          .warnings,
      ).toEqual([
        'SQL references unknown variable $srvice. Available variables: service.',
      ]);
    });

    it('accepts a bare reference: the lucene format has a valid empty state', () => {
      expect(
        validate('ServiceName:$service', [SERVICE], {
          language: 'lucene',
        }),
      ).toEqual({ errors: [], warnings: [] });
    });

    it('accepts a quoted reference: quoting opts into exact matches', () => {
      expect(
        validate('ServiceName:"$service"', [SERVICE], {
          language: 'lucene',
        }),
      ).toEqual({ errors: [], warnings: [] });
    });

    // The macros are never expanded here, so nothing downstream would say so.
    it.each([
      '$__filter(ServiceName, $service)',
      '$__conditionalAll(ServiceName = 1, $service)',
    ])('errors on the macro %s, which is left as literal text', template => {
      expect(validate(template, [SERVICE], { language: 'lucene' })).toEqual({
        warnings: [
          `${template.slice(0, template.indexOf('('))} has no meaning in a Lucene expression — ` +
            'it is left as written and matched as literal text. Switch this input to SQL, ' +
            'or reference the variable directly, as in <field>:$service.',
        ],
        errors: [],
      });
    });

    it('reports a macro naming an unknown variable the same way', () => {
      expect(
        validate('$__filter(ServiceName, $srvice)', [SERVICE], {
          language: 'lucene',
        }).warnings,
      ).toEqual([
        '$__filter has no meaning in a Lucene expression — it is left as written ' +
          'and matched as literal text. Switch this input to SQL, or reference the ' +
          'variable directly, as in <field>:$srvice.',
      ]);
    });

    it('leaves the same macro alone in a SQL expression, where it expands', () => {
      expect(
        validate('$__filter(ServiceName, $service)', [SERVICE], {
          language: 'sql',
        }),
      ).toEqual({ errors: [], warnings: [] });
    });
  });

  describe('a PromQL expression', () => {
    const promql = (template: string, variables?: ChartVariable[]) =>
      validate(template, variables, {
        subject: 'This expression',
        language: 'promql',
      });

    it('accepts the canonical matcher form', () => {
      // The SQL-only checks would call this both quoted (an error) and
      // unguarded (a warning); neither applies to the regex default.
      expect(promql('up{service=~"$service"}', [SERVICE])).toEqual({
        errors: [],
        warnings: [],
      });
    });

    it('accepts the braced and explicitly-formatted matcher forms', () => {
      expect(promql('up{service=~"${service}"}', [SERVICE])).toEqual({
        errors: [],
        warnings: [],
      });
      expect(promql('up{service=~"${service:regex}"}', [SERVICE])).toEqual({
        errors: [],
        warnings: [],
      });
    });

    it('still warns about a reference to a variable that does not exist', () => {
      const { errors, warnings } = promql('up{service=~"$srvice"}', [
        SERVICE,
        variable('env', ['prod']),
      ]);

      expect(errors).toEqual([]);
      expect(warnings).toEqual([
        'This expression references unknown variable $srvice. Available variables: service, env.',
      ]);
    });

    it('warns about a regex reference outside a quoted matcher value', () => {
      const { errors, warnings } = promql('up{service=~$service}', [SERVICE]);

      expect(errors).toEqual([]);
      expect(warnings).toEqual([
        '$service expands to a regular expression, which is only valid inside a quoted matcher value. Wrap it as {<label>=~"$service"}, or use ${service:csv} to interpolate the values as written.',
      ]);
    });

    it('warns the same way about a reference pasted into a metric name', () => {
      expect(promql('${service}_total', [SERVICE]).warnings).toHaveLength(1);
    });

    it('says nothing about a csv reference outside a literal, which is raw', () => {
      expect(promql('sum by (${service:csv}) (up)', [SERVICE])).toEqual({
        errors: [],
        warnings: [],
      });
    });

    it.each([
      '$__filter(service, $service)',
      '$__conditionalAll(up, $service)',
    ])('errors on the macro %s, which is sent verbatim', template => {
      expect(promql(template, [SERVICE])).toEqual({
        warnings: [
          `${template.slice(0, template.indexOf('('))} has no meaning in a PromQL expression — ` +
            'it is left as written and sent to Prometheus verbatim. Reference the ' +
            'variable directly, as in {<label>=~"$service"}.',
        ],
        errors: [],
      });
    });

    it('warns rather than errors when no variables are in scope', () => {
      expect(promql('up{service=~"$service"}', undefined)).toEqual({
        errors: [],
        warnings: [
          'This expression references $service, but no variables are available here.',
        ],
      });
    });
  });
});

describe('macros naming an unknown variable', () => {
  it('reports the message expansion gives', () => {
    const { errors, warnings } = validateVariableReferencesInTemplate(
      '$__filter(ServiceName, $tenant)',
      [SERVICE],
    );

    expect(warnings).toEqual([]);
    expect(errors).toEqual([
      "Macro '$__filter' references unknown variable 'tenant'. Available variables: service.",
    ]);
  });

  it('says nothing when the macro names a declared variable', () => {
    expect(
      validateVariableReferencesInTemplate(
        "$__conditionalAll(ServiceName != 'api', $service)",
        [SERVICE],
      ),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('leaves the Lucene message alone rather than piling on', () => {
    // In a Lucene input the macro is literal text, so complaining about the
    // name it happens to carry is noise on top of the real problem.
    const { errors, warnings } = validateVariableReferencesInTemplate(
      '$__filter(ServiceName, tenant)',
      [SERVICE],
      { language: 'lucene' },
    );

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no meaning in a Lucene expression');
  });
});

// A `STATIC_LIST` dashboard filter declares a variable with no `expression`:
// its values are authored, not queried, so there is no column to filter on.
// Every reference form still works except the one-argument `$__filter`, which
// has nothing to render — this is what the reference layer owes that filter
// type, so pin it.
describe('a variable with no expression', () => {
  const ENV = variable('env', ['prod']);
  const EMPTY_ENV = variable('env', []);

  describe('$__filter($name)', () => {
    // The check sits before the empty-selection shortcut on purpose, so the
    // author is told regardless of what happens to be selected.
    it.each([
      ['with a selection', ENV],
      ['with nothing selected', EMPTY_ENV],
    ])('throws %s', (_label, env) => {
      expect(() =>
        substituteVariablesSql('WHERE $__filter($env)', [env]),
      ).toThrow(
        "Macro '$__filter($env)' requires the variable's filter expression, which " +
          'is not available — pass it explicitly, e.g. $__filter(<expression>, $env).',
      );
    });

    it('is reported as an editor error rather than a warning', () => {
      const { errors, warnings } = validateVariableReferencesInTemplate(
        'WHERE $__filter($env)',
        [ENV],
      );

      expect(errors).toEqual([
        "Macro '$__filter($env)' requires the variable's filter expression, which " +
          'is not available — pass it explicitly, e.g. $__filter(<expression>, $env).',
      ]);
      expect(warnings).toEqual([]);
    });
  });

  it('expands the two-argument $__filter form', () => {
    expect(
      substituteVariablesSql('WHERE $__filter(ServiceName, $env)', [ENV]),
    ).toBe("WHERE (ServiceName IN ('prod'))");
  });

  it('expands $__conditionalAll', () => {
    expect(
      substituteVariablesSql(
        'WHERE $__conditionalAll(ServiceName IN ($env), $env)',
        [ENV],
      ),
    ).toBe("WHERE (ServiceName IN ('prod'))");
    expect(
      substituteVariablesSql(
        'WHERE $__conditionalAll(ServiceName IN ($env), $env)',
        [EMPTY_ENV],
      ),
    ).toBe("WHERE (1=1 /** no values selected for variable 'env' */)");
  });

  it.each(['$env', '${env}', '${env:csv}'])('expands %s', reference => {
    expect(
      substituteVariablesSql(`WHERE ServiceName IN (${reference})`, [ENV]),
    ).toBe(
      reference === '${env:csv}'
        ? 'WHERE ServiceName IN (prod)'
        : "WHERE ServiceName IN ('prod')",
    );
  });

  it('accepts the guarded and macro forms without complaint', () => {
    for (const template of [
      '$__filter(ServiceName, $env)',
      '$__conditionalAll(ServiceName IN ($env), $env)',
    ]) {
      expect(validateVariableReferencesInTemplate(template, [ENV])).toEqual({
        errors: [],
        warnings: [],
      });
    }
  });
});
