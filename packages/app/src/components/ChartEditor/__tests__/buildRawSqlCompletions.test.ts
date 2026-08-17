import { ChartVariable, DisplayType } from '@hyperdx/common-utils/dist/types';

import { buildRawSqlCompletions } from '@/components/ChartEditor/utils';

const SERVICE: ChartVariable = {
  name: 'service',
  values: ['api', 'web'],
  expression: 'ServiceName',
};

const labels = (variables: ChartVariable[] | undefined) =>
  buildRawSqlCompletions({ displayType: DisplayType.Table, variables }).map(
    completion => completion.label,
  );

const find = (variables: ChartVariable[] | undefined, label: string) =>
  buildRawSqlCompletions({ displayType: DisplayType.Table, variables }).find(
    completion => completion.label === label,
  );

/** The rendered help for a completion, whether it is a string or a Node. */
const infoOf = (variables: ChartVariable[] | undefined, label: string) => {
  const { info } = find(variables, label) ?? {};
  if (typeof info !== 'function') return info;
  const rendered = info();
  return rendered instanceof HTMLElement ? rendered : undefined;
};

const infoText = (variables: ChartVariable[] | undefined, label: string) => {
  const info = infoOf(variables, label);
  return typeof info === 'string' ? info : (info?.textContent ?? '');
};

describe('buildRawSqlCompletions', () => {
  it('offers the query params for the display type', () => {
    expect(labels(undefined)).toEqual(
      expect.arrayContaining([
        '{startDateMilliseconds:Int64}',
        '{endDateMilliseconds:Int64}',
      ]),
    );
  });

  it('offers only the params the display type supports', () => {
    const timeSeries = buildRawSqlCompletions({
      displayType: DisplayType.Line,
      variables: undefined,
    }).map(c => c.label);
    expect(timeSeries).toContain('{intervalSeconds:Int64}');
    expect(labels(undefined)).not.toContain('{intervalSeconds:Int64}');
  });

  it('always offers the standard macros', () => {
    expect(labels(undefined)).toEqual(
      expect.arrayContaining(['$__timeFilter', '$__sourceTable', '$__filters']),
    );
  });

  it('opens an argument list only for macros that take arguments', () => {
    expect(find(undefined, '$__timeFilter')?.apply).toBe('$__timeFilter(');
    expect(find(undefined, '$__interval_s')?.apply).toBe('$__interval_s');
  });

  it('inserts a param with its own closing brace', () => {
    // The completion source's replace range covers the `}` the editor
    // auto-inserts after `{`, so omitting it here truncates the param.
    expect(find(undefined, '{startDateMilliseconds:Int64}')?.apply).toBe(
      '{startDateMilliseconds:Int64}',
    );
  });

  describe('with no variables', () => {
    it.each([
      ['off a dashboard', undefined],
      ['on a dashboard that defines none', [] as ChartVariable[]],
    ])('withholds the variable macros %s', (_label, variables) => {
      expect(labels(variables)).not.toContain('$__filter');
      expect(labels(variables)).not.toContain('$__conditionalAll');
    });
  });

  describe('with variables', () => {
    it('offers the variable macros', () => {
      expect(labels([SERVICE])).toEqual(
        expect.arrayContaining(['$__filter', '$__conditionalAll']),
      );
    });

    it('inserts the one-argument filter as written', () => {
      // Not rewritten to `$__filter(ServiceName, service)`: the one-argument
      // form is valid on its own, and the bare `$__filter` completion is
      // already there for anyone who wants to pass an expression.
      expect(find([SERVICE], '$__filter(service)')?.apply).toBe(
        '$__filter(service)',
      );
    });

    it('withholds the one-argument filter when the variable has no expression', () => {
      // Nothing for `$__filter(env)` to filter on, so it would throw at render.
      const staticVariable: ChartVariable = { name: 'env', values: ['prod'] };
      expect(labels([staticVariable])).not.toContain('$__filter(env)');
      expect(labels([staticVariable])).toContain('$env');
    });

    it('offers the bare reference and warns about it in the hover text', () => {
      expect(find([SERVICE], '$service')?.apply).toBe('$service');
      expect(infoText([SERVICE], '$service')).toContain(
        '$__filter(<expression>, service)',
      );
    });

    it('offers the braced forms, which are the only match once ${ is typed', () => {
      // `${` cannot fuzzy-match `$service`, so without these the popup is
      // empty the moment a user types the Grafana-style opening brace.
      expect(find([SERVICE], '${service}')?.apply).toBe('${service}');
      expect(find([SERVICE], '${service:csv}')?.apply).toBe('${service:csv}');
    });

    it('offers every supported format', () => {
      expect(labels([SERVICE])).toEqual(
        expect.arrayContaining([
          '${service:sqlstring}',
          '${service:csv}',
          '${service:regex}',
          '${service:lucene}',
        ]),
      );
    });

    const footnoteOf = (
      variables: ChartVariable[],
      label: string,
    ): string | undefined => {
      const info = infoOf(variables, label);
      // A plain string means the completion has no second line at all.
      if (typeof info !== 'object') return undefined;
      return (
        info.querySelector('.cm-completionInfo-footnote')?.textContent ??
        undefined
      );
    };

    it.each([
      [
        '$__filter(service)',
        "Expands to: (toString(ServiceName) IN ('api', 'web'))",
      ],
      ['$service', "Expands to: 'api', 'web'"],
      ['${service}', "Expands to: 'api', 'web'"],
      ['${service:sqlstring}', "Expands to: 'api', 'web'"],
      ['${service:csv}', 'Expands to: api,web'],
      ['${service:regex}', 'Expands to: (api|web)'],
      ['${service:lucene}', 'Expands to: ("api" OR "web")'],
    ])('shows what %s expands to', (label, expected) => {
      expect(footnoteOf([SERVICE], label)).toBe(expected);
    });

    it('puts the expansion on its own line, not appended to the prose', () => {
      // A string `info` renders as one text node, so the expansion has to be a
      // separate element to reliably sit on its own line.
      const info = infoOf([SERVICE], '$service');
      if (typeof info !== 'object') throw new Error('expected rendered markup');
      const footnote = info.querySelector('.cm-completionInfo-footnote');
      expect(info.firstChild).not.toBe(footnote);
      expect(info.firstChild?.textContent).not.toContain('Expands to:');
    });

    it.each([
      ['$__filter(service)', 'Expands to: (1=1'],
      ['$service', 'Expands to: NULL'],
      ['${service:csv}', 'Expands to: (empty string)'],
      ['${service:regex}', 'Expands to: .*'],
    ])('shows the empty-selection expansion of %s', (label, expected) => {
      const unselected: ChartVariable = {
        name: 'service',
        values: [],
        expression: 'ServiceName',
      };
      expect(footnoteOf([unselected], label)).toContain(expected);
    });

    it('offers the same set of completions for every variable', () => {
      const second: ChartVariable = {
        name: 'env',
        values: [],
        expression: 'Env',
      };
      expect(labels([SERVICE, second])).toEqual(
        expect.arrayContaining([
          '$__filter(service)',
          '$service',
          '${service}',
          '${service:csv}',
          '$__filter(env)',
          '$env',
          '${env}',
          '${env:csv}',
        ]),
      );
    });
  });
});
