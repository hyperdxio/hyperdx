import {
  findMaskedTemplateRanges,
  maskPromqlTemplates,
  templateMaskedPromqlLanguage,
} from '@/components/PromQLEditor/templateMaskedLanguage';

const errorSpans = (doc: string, enableMacros = true) => {
  const spans: string[] = [];
  templateMaskedPromqlLanguage({ enableMacros })
    .parser.parse(doc)
    .iterate({
      enter: node => {
        if (node.type.isError) spans.push(doc.slice(node.from, node.to));
      },
    });
  return spans;
};

describe('findMaskedTemplateRanges', () => {
  it('covers each macro and reference exactly', () => {
    const expression = 'topk($k, rate(up[$__rate_interval]))';
    expect(
      findMaskedTemplateRanges(expression, { enableMacros: true }).map(
        ({ from, to }) => expression.slice(from, to),
      ),
    ).toEqual(['$k', '$__rate_interval']);
  });

  it('leaves references inside label strings alone', () => {
    expect(
      findMaskedTemplateRanges('up{service=~"$service"}', {
        enableMacros: true,
      }),
    ).toEqual([]);
  });
});

describe('maskPromqlTemplates', () => {
  it('keeps the expression length', () => {
    const expression = 'rate(up{a="$a"}[$__interval]) * $k';
    const masked = maskPromqlTemplates(expression, { enableMacros: true });
    expect(masked).toBe('rate(up{a="$a"}[11111111111]) * aa');
    expect(masked).toHaveLength(expression.length);
  });

  it('masks a variable in a label-name position as an identifier', () => {
    expect(
      maskPromqlTemplates('sum by (${service:csv}) (up)', {
        enableMacros: true,
      }),
    ).toBe('sum by (aaaaaaaaaaaaaa) (up)');
  });
});

describe('templateMaskedPromqlLanguage', () => {
  it('parses macros in range and offset positions', () => {
    expect(
      errorSpans(
        'sum(rate(up[$__range])) + avg_over_time(up[$__interval] offset $__rate_interval)',
      ),
    ).toEqual([]);
  });

  it('parses variables in metric and label name positions', () => {
    expect(errorSpans('sum by (${service:csv}) (up)')).toEqual([]);
    expect(errorSpans('sum by (job, $label) ($metric{${key}="x"})')).toEqual(
      [],
    );
    expect(errorSpans('a / on(${keys:csv}) group_left($extra) b')).toEqual([]);
  });

  it('rejects a variable in a duration position', () => {
    expect(errorSpans('rate(up[$window])')).not.toEqual([]);
  });

  it('keeps node offsets on the original text', () => {
    const doc = 'rate(up[$__range])';
    const spans: string[] = [];
    templateMaskedPromqlLanguage({ enableMacros: true })
      .parser.parse(doc)
      .iterate({
        enter: node => {
          if (node.name === 'NumberDurationLiteralInDurationContext') {
            spans.push(doc.slice(node.from, node.to));
          }
        },
      });
    expect(spans).toEqual(['$__range']);
  });

  it('rejects macros when macros are disabled', () => {
    expect(errorSpans('rate(up[$__interval])', false)).not.toEqual([]);
  });

  it('parses a macro given arguments', () => {
    expect(errorSpans('rate(up[$__interval(1)])')).toEqual([]);
  });

  it('still rejects errors elsewhere in the expression', () => {
    expect(errorSpans('rate(up[$__interval]) +')).not.toEqual([]);
  });
});
