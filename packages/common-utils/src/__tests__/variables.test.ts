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
  substituteVariables,
  substituteVariablesForLanguage,
  validateVariableReferencesInTemplate,
} from '@/variables';

const variable = (
  name: string,
  values: string[],
  expression?: string,
): ChartVariable => ({ name, values, expression });

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
        substituteVariables('WHERE ServiceName IN ($service)', [SERVICE]),
      ).toBe("WHERE ServiceName IN ('api', 'web')");
    });

    it('substitutes NULL when nothing is selected', () => {
      expect(
        substituteVariables('WHERE ServiceName IN ($service)', [EMPTY_SERVICE]),
      ).toBe('WHERE ServiceName IN (NULL)');
    });

    it('leaves an unknown name verbatim', () => {
      expect(substituteVariables("SELECT '$notAVariable'", [SERVICE])).toBe(
        "SELECT '$notAVariable'",
      );
    });

    it('matches names maximally so a longer name is not partially replaced', () => {
      expect(substituteVariables('$service_name', [SERVICE])).toBe(
        '$service_name',
      );
      expect(
        substituteVariables('$service_name', [
          SERVICE,
          variable('service_name', ['checkout']),
        ]),
      ).toBe("'checkout'");
    });

    it('leaves a lone $ and $-digit sequences alone', () => {
      expect(substituteVariables('SELECT $, $1, x$', [SERVICE])).toBe(
        'SELECT $, $1, x$',
      );
    });

    it('applies the caller-provided default format', () => {
      expect(
        substituteVariables('{service="$service"}', [SERVICE], {
          defaultFormat: 'regex',
        }),
      ).toBe('{service="(api|web)"}');
    });
  });

  describe('braced references', () => {
    it('substitutes ${name} with the default format', () => {
      expect(substituteVariables('${service}', [SERVICE])).toBe("'api', 'web'");
    });

    it.each([
      ['sqlstring', "'api', 'web'"],
      ['regex', '(api|web)'],
      ['csv', 'api,web'],
      ['lucene', '("api" OR "web")'],
    ])('substitutes ${name:%s}', (format, expected) => {
      expect(substituteVariables(`\${service:${format}}`, [SERVICE])).toBe(
        expected,
      );
    });

    it('leaves an unknown name verbatim, format and all', () => {
      expect(substituteVariables('${other:csv}', [SERVICE])).toBe(
        '${other:csv}',
      );
    });

    it('throws on an unknown format for a known name', () => {
      expect(() => substituteVariables('${service:json}', [SERVICE])).toThrow(
        "Unknown variable format 'json'",
      );
    });

    it('leaves a malformed brace expression as plain text', () => {
      expect(substituteVariables('${not a name}', [SERVICE])).toBe(
        '${not a name}',
      );
      expect(substituteVariables('${service', [SERVICE])).toBe('${service');
    });
  });

  describe('$__filter', () => {
    it('expands the two-argument form against the given expression', () => {
      expect(
        substituteVariables('WHERE $__filter(ServiceName, service)', [SERVICE]),
      ).toBe("WHERE (ServiceName IN ('api', 'web'))");
    });

    it('expands the one-argument form using the variable expression', () => {
      expect(substituteVariables('WHERE $__filter(service)', [SERVICE])).toBe(
        "WHERE (toString(ServiceName) IN ('api', 'web'))",
      );
    });

    it('accepts a $-prefixed name argument', () => {
      expect(
        substituteVariables('WHERE $__filter(ServiceName, $service)', [
          SERVICE,
        ]),
      ).toBe("WHERE (ServiceName IN ('api', 'web'))");
    });

    it('rejects a braced name argument', () => {
      expect(() =>
        substituteVariables('WHERE $__filter(ServiceName, ${service})', [
          SERVICE,
        ]),
      ).toThrow("Macro '$__filter' references unknown variable '{service}'");
    });

    it('expands to a no-op predicate when nothing is selected', () => {
      expect(
        substituteVariables('WHERE $__filter(ServiceName, service)', [
          EMPTY_SERVICE,
        ]),
      ).toBe("WHERE (1=1 /** no values selected for variable 'service' */)");
    });

    it('substitutes references nested in the expression argument', () => {
      expect(
        substituteVariables("WHERE $__filter(concat(col, '$env'), service)", [
          SERVICE,
          variable('env', ['prod']),
        ]),
      ).toBe("WHERE (concat(col, ''prod'') IN ('api', 'web'))");
    });

    it('throws when the named variable does not exist', () => {
      expect(() =>
        substituteVariables('WHERE $__filter(ServiceName, nope)', [SERVICE]),
      ).toThrow("Macro '$__filter' references unknown variable 'nope'");
    });

    it('throws a typed UnknownVariableError carrying the name and the declared set', () => {
      // Callers outside this package react to this specific failure (the MCP
      // tools attach a "declare the filter as a variable" hint to it), and
      // must not have to match on the message to recognize it.
      expect.assertions(5);
      try {
        substituteVariables('WHERE $__filter(ServiceName, nope)', [
          SERVICE,
          variable('env', ['prod']),
        ]);
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
        substituteVariables('WHERE $__conditionalAll(1=1, nope)', []);
      } catch (e) {
        expect((e as UnknownVariableError).availableVariables).toEqual([]);
      }
    });

    it('throws on the one-argument form when the variable has no expression', () => {
      expect(() =>
        substituteVariables('WHERE $__filter(service)', [
          variable('service', ['api']),
        ]),
      ).toThrow("Macro '$__filter(service)' requires the variable's filter");
    });

    it('throws on a bad argument count', () => {
      expect(() =>
        substituteVariables('$__filter(a, b, c)', [SERVICE]),
      ).toThrow("Macro 'filter' expects 1-2 argument(s), but got 3");
    });
  });

  describe('$__conditionalAll', () => {
    it('emits the condition when values are selected', () => {
      expect(
        substituteVariables(
          "WHERE $__conditionalAll(ServiceName = 'api', service)",
          [SERVICE],
        ),
      ).toBe("WHERE (ServiceName = 'api')");
    });

    it('emits a no-op predicate when nothing is selected', () => {
      expect(
        substituteVariables(
          "WHERE $__conditionalAll(ServiceName = 'api', service)",
          [EMPTY_SERVICE],
        ),
      ).toBe("WHERE (1=1 /** no values selected for variable 'service' */)");
    });

    it('substitutes references inside the condition', () => {
      expect(
        substituteVariables(
          'WHERE $__conditionalAll(ServiceName IN ($service), service)',
          [SERVICE],
        ),
      ).toBe("WHERE (ServiceName IN ('api', 'web'))");
    });

    it('throws when the named variable does not exist', () => {
      expect(() =>
        substituteVariables('$__conditionalAll(x = 1, nope)', [SERVICE]),
      ).toThrow("Macro '$__conditionalAll' references unknown variable 'nope'");
    });

    it('throws on a bad argument count', () => {
      expect(() => substituteVariables('$__conditionalAll(x = 1)', [SERVICE])) //
        .toThrow("Macro 'conditionalAll' expects 2 argument(s), but got 1");
    });
  });

  describe('argument parsing', () => {
    it('handles a close paren inside a quoted argument', () => {
      expect(
        substituteVariables("$__conditionalAll(col = 'a)b', service)", [
          SERVICE,
        ]),
      ).toBe("(col = 'a)b')");
    });

    it('handles an open paren and a comma inside a quoted argument', () => {
      expect(
        substituteVariables("$__conditionalAll(col = 'a,(b', service)", [
          SERVICE,
        ]),
      ).toBe("(col = 'a,(b')");
    });

    it('handles nested parens in the condition', () => {
      expect(
        substituteVariables(
          '$__conditionalAll(has(splitByChar(:, col), 1), service)',
          [SERVICE],
        ),
      ).toBe('(has(splitByChar(:, col), 1))');
    });

    it('throws when the argument list is never closed', () => {
      expect(() =>
        substituteVariables('$__filter(ServiceName, service', [SERVICE]),
      ).toThrow(MalformedMacroArgsError);
    });
  });

  it('does not re-expand values that themselves look like references', () => {
    expect(
      substituteVariables('$a $b', [
        variable('a', ['$b']),
        variable('b', ['literal']),
      ]),
    ).toBe("'$b' 'literal'");
  });

  it('leaves non-variable macros untouched', () => {
    expect(
      substituteVariables('WHERE $__timeFilter(ts) AND $__filters', [SERVICE]),
    ).toBe('WHERE $__timeFilter(ts) AND $__filters');
  });

  it('does not treat $__filters as the $__filter macro', () => {
    expect(substituteVariables('$__filters', [SERVICE])).toBe('$__filters');
  });
});

describe('substituteVariablesForLanguage', () => {
  it('expands references as SQL strings and macros as predicates for sql', () => {
    expect(
      substituteVariablesForLanguage(
        'ServiceName IN ($service) AND $__filter(ServiceName, service)',
        [SERVICE],
        'sql',
      ),
    ).toBe("ServiceName IN ('api', 'web') AND (ServiceName IN ('api', 'web'))");
  });

  it('expands references in the lucene format for lucene', () => {
    expect(
      substituteVariablesForLanguage(
        'ServiceName:$service',
        [SERVICE],
        'lucene',
      ),
    ).toBe('ServiceName:("api" OR "web")');
  });

  it('leaves macros as written in a lucene expression', () => {
    expect(
      substituteVariablesForLanguage(
        '$__filter(ServiceName, service)',
        [SERVICE],
        'lucene',
      ),
    ).toBe('$__filter(ServiceName, service)');
  });

  it('renders an empty selection in each language', () => {
    expect(
      substituteVariablesForLanguage(
        'ServiceName IN ($service)',
        [EMPTY_SERVICE],
        'sql',
      ),
    ).toBe('ServiceName IN (NULL)');
    expect(
      substituteVariablesForLanguage(
        'ServiceName:$service',
        [EMPTY_SERVICE],
        'lucene',
      ),
    ).toBe('ServiceName:("")');
  });
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
        '$__filter(ServiceName, service) $__conditionalAll(x = 1, region)',
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
      expect(substituteVariables('-- see $service\nSELECT 1', [SERVICE])).toBe(
        '-- see $service\nSELECT 1',
      );
      expect(substituteVariables('/* $service */ SELECT 1', [SERVICE])).toBe(
        '/* $service */ SELECT 1',
      );
    });

    it('substitutes normally after a comment ends', () => {
      expect(
        substituteVariables('-- see $service\nWHERE a IN ($service)', [
          SERVICE,
        ]),
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
      getVariableReferences("$__filter(concat(col, '$env'), service)"),
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
      getVariableReferences('$__conditionalAll(ServiceName IN ($svc), svc)'),
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
      getVariableReferences('WHERE a IN ($svc) AND $__filter(b, other)'),
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
    expect(hasVariableMacro('WHERE $__filter(ServiceName, service)')).toBe(
      true,
    );
    expect(hasVariableMacro('WHERE $__conditionalAll(x = 1, region)')).toBe(
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
        '$__filter(ServiceName, service) $__filter(env) $__conditionalAll(x = 1, region)',
      ),
    ).toEqual(['service', 'env', 'region']);
  });

  it('collects references nested inside macro expression arguments', () => {
    expect(
      getReferencedVariableNames(
        '$__conditionalAll(ServiceName IN ($service), region)',
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
          'WHERE $__filter(RegionName, region) AND ServiceName = $service',
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

  it('returns an empty array for a PromQL config even when its expression mentions a variable', () => {
    expect(
      filterReferencedVariables(
        {
          configType: 'promql',
          promqlExpression: 'up{service="$service"}',
          connection: 'local',
        },
        variables,
      ),
    ).toEqual([]);
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
          groupBy: [{ valueExpression: '$__filter(RegionName, region)' }],
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

  it('says nothing for a PromQL config, which cannot use variables', () => {
    expect(
      getAlertVariableWarning(
        {
          configType: 'promql',
          promqlExpression: 'up{service="$service"}',
          connection: 'local',
        },
        variables,
      ),
    ).toBeUndefined();
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
          where: '$__filter(ServiceName, service)',
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
      '$__filter(ServiceName, service) $__conditionalAll(a, foo)';
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
          having: '$__filter(ServiceName, service)',
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
          groupBy: '$__conditionalAll(ServiceName, service)',
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
          where: '$__filter(ServiceName, service)',
          variables: [EMPTY_SERVICE],
        }),
      ).where,
    ).toBe("(1=1 /** no values selected for variable 'service' */)");
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
      '$service is wrapped in quotes, but the default sqlstring format already quotes each value. Did you mean to use $__filter(<expression>, service) or ${service:csv} instead?',
    ]);
  });

  it('warns that a bare reference renders as NULL before anything is selected', () => {
    const { errors, warnings } = validate('ServiceName IN ($service)', [
      SERVICE,
    ]);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      '$service has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, service) or $__conditionalAll(<condition>, service) so the query stays valid when no values are selected.',
    ]);
  });

  it('accepts a reference guarded by its own variable macro', () => {
    expect(
      validate('$__filter(ServiceName IN ($service), service)', [SERVICE]),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a format that has a valid empty state', () => {
    expect(validate('match(ServiceName, ${service:regex})', [SERVICE])).toEqual(
      { errors: [], warnings: [] },
    );
  });

  describe('with no variable context at all', () => {
    it('errors on a macro, which can only have been meant as one', () => {
      expect(validate('$__filter(ServiceName, service)', undefined)).toEqual({
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
        validate('ServiceName:$service', [SERVICE], { language: 'lucene' }),
      ).toEqual({ errors: [], warnings: [] });
    });

    it('accepts a quoted reference: the lucene format quotes each value', () => {
      expect(
        validate('ServiceName:"$service"', [SERVICE], { language: 'lucene' }),
      ).toEqual({ errors: [], warnings: [] });
    });

    // The macros are never expanded here, so nothing downstream would say so.
    it.each([
      '$__filter(ServiceName, service)',
      '$__conditionalAll(ServiceName = 1, service)',
    ])('errors on the macro %s, which is left as literal text', template => {
      expect(validate(template, [SERVICE], { language: 'lucene' })).toEqual({
        errors: [
          `${template.slice(0, template.indexOf('('))} has no meaning in a Lucene expression — ` +
            'it is left as written and matched as literal text. Switch this input to SQL, ' +
            'or reference the variable directly, as in <field>:$service.',
        ],
        warnings: [],
      });
    });

    it('reports a macro naming an unknown variable the same way', () => {
      expect(
        validate('$__filter(ServiceName, srvice)', [SERVICE], {
          language: 'lucene',
        }).errors,
      ).toEqual([
        '$__filter has no meaning in a Lucene expression — it is left as written ' +
          'and matched as literal text. Switch this input to SQL, or reference the ' +
          'variable directly, as in <field>:$srvice.',
      ]);
    });

    it('leaves the same macro alone in a SQL expression, where it expands', () => {
      expect(
        validate('$__filter(ServiceName, service)', [SERVICE], {
          language: 'sql',
        }),
      ).toEqual({ errors: [], warnings: [] });
    });
  });
});

describe('reportUnknownMacroVariables', () => {
  it('stays quiet about a macro naming an unknown variable by default', () => {
    // The chart editor gets this message from expansion instead, and would
    // otherwise print it twice.
    expect(
      validateVariableReferencesInTemplate('$__filter(ServiceName, tenant)', [
        SERVICE,
      ]),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('reports a macro naming an unknown variable when asked', () => {
    const { errors, warnings } = validateVariableReferencesInTemplate(
      '$__filter(ServiceName, tenant)',
      [SERVICE],
      { reportUnknownMacroVariables: true },
    );

    expect(warnings).toEqual([]);
    expect(errors).toEqual([
      "SQL uses $__filter on unknown variable 'tenant'. Available variables: service.",
    ]);
  });

  it('says nothing when the macro names a declared variable', () => {
    expect(
      validateVariableReferencesInTemplate(
        "$__conditionalAll(ServiceName != 'api', service)",
        [SERVICE],
        { reportUnknownMacroVariables: true },
      ),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('leaves the Lucene message alone rather than piling on', () => {
    // In a Lucene input the macro is literal text, so complaining about the
    // name it happens to carry is noise on top of the real problem.
    const { errors } = validateVariableReferencesInTemplate(
      '$__filter(ServiceName, tenant)',
      [SERVICE],
      { language: 'lucene', reportUnknownMacroVariables: true },
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no meaning in a Lucene expression');
  });
});
