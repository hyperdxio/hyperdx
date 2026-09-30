import { ChartVariable } from '@hyperdx/common-utils/dist/types';

import { buildPromqlVariableCompletions } from '@/components/SQLEditor/variableCompletions';

const SERVICE: ChartVariable = {
  name: 'service',
  values: ['api', 'web'],
  expression: 'ServiceName',
};

const completions = (variables: ChartVariable[] | undefined) =>
  buildPromqlVariableCompletions(variables);

const labels = (variables: ChartVariable[] | undefined) =>
  completions(variables).map(completion => completion.label);

const find = (variables: ChartVariable[], label: string) =>
  completions(variables).find(completion => completion.label === label);

/** The rendered help for a completion, whether it is a string or a Node. */
const infoOf = (variables: ChartVariable[], label: string) => {
  const { info } = find(variables, label) ?? {};
  if (typeof info !== 'function') return info;
  const rendered = info();
  return rendered instanceof HTMLElement ? rendered : undefined;
};

/** The second line of a completion's help — what it expands to right now. */
const footnoteOf = (variables: ChartVariable[], label: string) => {
  const info = infoOf(variables, label);
  // A plain string means the completion has no second line at all.
  if (typeof info !== 'object') return undefined;
  return (
    info?.querySelector('.cm-completionInfo-footnote')?.textContent ?? undefined
  );
};

describe('buildPromqlVariableCompletions', () => {
  it.each([
    ['off a dashboard', undefined],
    ['on a dashboard that defines none', [] as ChartVariable[]],
  ])('offers nothing %s', (_label, variables) => {
    expect(buildPromqlVariableCompletions(variables)).toEqual([]);
  });

  it('offers every PromQL-valid reference form, most useful first', () => {
    expect(labels([SERVICE])).toEqual([
      '$service',
      '${service}',
      '${service:regex}',
      '${service:csv}',
    ]);
  });

  it('inserts each form exactly as labelled', () => {
    expect(find([SERVICE], '${service}')?.apply).toBe('${service}');
    expect(find([SERVICE], '${service:regex}')?.apply).toBe('${service:regex}');
  });

  it('withholds the variable macros, which PromQL leaves as written', () => {
    // Substitution is macro-less for promql, so a suggested `$__filter(...)`
    // would reach Prometheus verbatim and fail to parse.
    expect(labels([SERVICE])).not.toContain('$__filter');
    expect(labels([SERVICE])).not.toContain('$__conditionalAll');
    expect(labels([SERVICE])).not.toContain('$__filter($service)');
  });

  it('withholds the formats that emit SQL or Lucene syntax', () => {
    // Still honoured if hand-typed — just never suggested, because neither
    // `'api', 'web'` nor `("api" OR "web")` parses inside a PromQL expression.
    expect(labels([SERVICE])).not.toContain('${service:sqlstring}');
    expect(labels([SERVICE])).not.toContain('${service:lucene}');
  });

  it('offers the same set of forms for every variable', () => {
    expect(labels([SERVICE, { name: 'env', values: ['prod'] }])).toEqual([
      '$service',
      '${service}',
      '${service:regex}',
      '${service:csv}',
      '$env',
      '${env}',
      '${env:regex}',
      '${env:csv}',
    ]);
  });

  it.each([
    ['$service', 'Expands to: (api|web)'],
    ['${service}', 'Expands to: (api|web)'],
    ['${service:regex}', 'Expands to: (api|web)'],
    ['${service:csv}', 'Expands to: api,web'],
  ])('shows what %s expands to under promql, not sql', (label, expected) => {
    expect(footnoteOf([SERVICE], label)).toBe(expected);
  });

  it('previews the empty selection as the match-everything regex', () => {
    // The reason the regex format is PromQL's default: with nothing selected a
    // `=~` matcher still matches, rather than becoming NULL as it would in SQL.
    const unselected: ChartVariable = { ...SERVICE, values: [] };
    expect(footnoteOf([unselected], '$service')).toBe('Expands to: .*');
    expect(footnoteOf([unselected], '${service:regex}')).toBe('Expands to: .*');
    expect(footnoteOf([unselected], '${service:csv}')).toBe(
      'Expands to: (empty string)',
    );
  });

  it('puts the expansion on its own line, not appended to the prose', () => {
    const info = infoOf([SERVICE], '$service');
    if (typeof info !== 'object') throw new Error('expected rendered markup');
    const footnote = info?.querySelector('.cm-completionInfo-footnote');
    expect(info?.firstChild).not.toBe(footnote);
    expect(info?.firstChild?.textContent).not.toContain('Expands to:');
  });
});
