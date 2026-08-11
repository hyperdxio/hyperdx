import type { ChartVariable } from '@/types';
import {
  filterReferencedVariables,
  formatVariableValues,
  getReferencedVariableNames,
  substituteVariables,
} from '@/variables';

const variable = (
  name: string,
  values: string[],
  expression?: string,
): ChartVariable => ({ name, values, expression });

const SERVICE = variable('service', ['api', 'web'], 'ServiceName');
const EMPTY_SERVICE = variable('service', [], 'ServiceName');

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
    it('renders a match-all wildcard when nothing is selected', () => {
      expect(formatVariableValues([], 'lucene')).toBe('*');
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
      ).toThrow('Failed to parse macro arguments');
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

  it('returns an empty array for a builder config even when its fields mention a variable', () => {
    expect(
      filterReferencedVariables(
        {
          select: 'count()',
          from: { databaseName: 'default', tableName: 'logs' },
          where: 'ServiceName = $service',
          whereLanguage: 'sql',
          timestampValueExpression: 'Timestamp',
          connection: 'local',
        },
        variables,
      ),
    ).toEqual([]);
  });
});
