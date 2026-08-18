import { ChartVariable } from '@hyperdx/common-utils/dist/types';

import {
  buildLuceneVariableSuggestions,
  buildVariableCompletions,
  expandLuceneVariablesForEnglishDisplay,
} from '@/components/SQLEditor/variableCompletions';

const SERVICE: ChartVariable = {
  name: 'service',
  values: ['api', 'web'],
  expression: 'ServiceName',
};

const labels = (variables: ChartVariable[] | undefined) =>
  buildVariableCompletions(variables).map(completion => completion.label);

/** The second line of a completion's help — what it expands to right now. */
const footnoteOf = (variables: ChartVariable[], label: string) => {
  const { info } = buildVariableCompletions(variables).find(
    completion => completion.label === label,
  ) ?? { info: undefined };
  if (typeof info !== 'function') return undefined;
  const rendered = info();
  if (!(rendered instanceof HTMLElement)) return undefined;
  return (
    rendered.querySelector('.cm-completionInfo-footnote')?.textContent ??
    undefined
  );
};

describe('buildVariableCompletions', () => {
  it.each([
    ['off a dashboard', undefined],
    ['on a dashboard that defines none', [] as ChartVariable[]],
  ])('offers nothing %s', (_label, variables) => {
    expect(buildVariableCompletions(variables)).toEqual([]);
  });

  it('offers the variable macros and every reference form', () => {
    expect(labels([SERVICE])).toEqual(
      expect.arrayContaining([
        '$__filter',
        '$__conditionalAll',
        '$__filter(service)',
        '$service',
        '${service}',
        '${service:sqlstring}',
        '${service:csv}',
        '${service:regex}',
        '${service:lucene}',
      ]),
    );
  });

  it('withholds the macros that a chart builder input never expands', () => {
    // Only the variable macros are substituted into builder expressions, so
    // offering $__timeFilter and friends here would suggest SQL that reaches
    // ClickHouse verbatim.
    expect(labels([SERVICE])).not.toContain('$__timeFilter');
    expect(labels([SERVICE])).not.toContain('$__sourceTable');
    expect(labels([SERVICE])).not.toContain('$__filters');
  });

  it('shows what each form expands to against the current selection', () => {
    expect(footnoteOf([SERVICE], '$service')).toBe("Expands to: 'api', 'web'");
    expect(footnoteOf([SERVICE], '$__filter(service)')).toBe(
      "Expands to: (toString(ServiceName) IN ('api', 'web'))",
    );
  });

  it('shows the empty-selection expansion when nothing is selected', () => {
    const unselected: ChartVariable = { ...SERVICE, values: [] };
    expect(footnoteOf([unselected], '$service')).toBe('Expands to: NULL');
    expect(footnoteOf([unselected], '$__filter(service)')).toContain(
      'Expands to: (1=1',
    );
    // The lucene form's empty term is itself a no-op once rendered to SQL.
    expect(footnoteOf([unselected], '${service:lucene}')).toBe(
      'Expands to: ("")',
    );
  });
});

describe('buildLuceneVariableSuggestions', () => {
  it.each([
    ['off a dashboard', undefined],
    ['on a dashboard that defines none', [] as ChartVariable[]],
  ])('offers nothing %s', (_label, variables) => {
    expect(buildLuceneVariableSuggestions(variables)).toEqual([]);
  });

  it('offers the bare reference and nothing else', () => {
    // No macros: they expand to SQL predicates a Lucene parser cannot read.
    // No braced or explicit-format forms either — in a Lucene input the bare
    // reference already renders in the lucene format.
    expect(buildLuceneVariableSuggestions([SERVICE])).toEqual([
      {
        value: '$service',
        label: '$service',
        description:
          'The selected values of service. Expands to: ("api" OR "web")',
      },
    ]);
  });

  it('previews the empty selection as the term that drops out', () => {
    expect(
      buildLuceneVariableSuggestions([{ ...SERVICE, values: [] }])[0]
        .description,
    ).toContain('Expands to: ("")');
  });
});

describe('expandLuceneVariablesForEnglishDisplay', () => {
  const expand = (text: string, variables?: ChartVariable[]) =>
    expandLuceneVariablesForEnglishDisplay(text, variables);

  it.each([
    ['off a dashboard', undefined],
    ['on a dashboard that defines none', [] as ChartVariable[]],
  ])('returns the text unchanged %s', (_label, variables) => {
    expect(expand('ServiceName:$service', variables)).toBe(
      'ServiceName:$service',
    );
  });

  it('expands a selected variable in the lucene format', () => {
    expect(expand('ServiceName:$service', [SERVICE])).toBe(
      'ServiceName:("api" OR "web")',
    );
  });

  it('leaves an unselected variable as written', () => {
    // `("")` reads as `'ServiceName' is <blank>` once serialized to English,
    // which is worse than naming the placeholder that has no value yet.
    expect(expand('ServiceName:$service', [{ ...SERVICE, values: [] }])).toBe(
      'ServiceName:$service',
    );
  });

  it('expands only the variables that have a selection', () => {
    expect(
      expand('ServiceName:$service AND Env:$env', [
        SERVICE,
        { name: 'env', values: [] },
      ]),
    ).toBe('ServiceName:("api" OR "web") AND Env:$env');
  });

  it('leaves unknown references and the variable macros alone', () => {
    expect(expand('$nope AND $__filter(ServiceName, service)', [SERVICE])).toBe(
      '$nope AND $__filter(ServiceName, service)',
    );
  });
});
