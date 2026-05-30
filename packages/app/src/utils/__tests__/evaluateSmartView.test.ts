import { evaluateSmartView } from '../evaluateSmartView';

type Item = { tags: string[] };

const view = (
  rules: Parameters<typeof evaluateSmartView>[0]['rules'],
  combinator: 'all' | 'any' = 'all',
) => ({ rules, combinator });

describe('evaluateSmartView', () => {
  it('matches every item when the rule list is empty', () => {
    const v = view([]);
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['anything'] } as Item)).toBe(true);
  });

  it('tag-includes passes only when the item carries that tag', () => {
    const v = view([{ kind: 'tag-includes', tag: 'checkout' }]);
    expect(evaluateSmartView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(
      evaluateSmartView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(true);
    expect(evaluateSmartView(v, { tags: ['payments'] } as Item)).toBe(false);
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(false);
  });

  it('tag-excludes passes when the item does not carry that tag', () => {
    const v = view([{ kind: 'tag-excludes', tag: 'payments' }]);
    expect(evaluateSmartView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['payments'] } as Item)).toBe(false);
    expect(
      evaluateSmartView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(false);
  });

  it('untagged passes only when the item has zero tags', () => {
    const v = view([{ kind: 'untagged' }]);
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['anything'] } as Item)).toBe(false);
  });

  it('combinator=all requires every rule to pass', () => {
    const v = view(
      [
        { kind: 'tag-includes', tag: 'checkout' },
        { kind: 'tag-excludes', tag: 'payments' },
      ],
      'all',
    );
    // Has checkout and not payments -> passes both
    expect(evaluateSmartView(v, { tags: ['checkout'] } as Item)).toBe(true);
    // Has checkout but also payments -> the second rule fails
    expect(
      evaluateSmartView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(false);
    // No checkout -> first rule fails
    expect(evaluateSmartView(v, { tags: ['payments'] } as Item)).toBe(false);
  });

  it('combinator=any passes when at least one rule passes', () => {
    const v = view(
      [
        { kind: 'tag-includes', tag: 'checkout' },
        { kind: 'tag-includes', tag: 'payments' },
      ],
      'any',
    );
    expect(evaluateSmartView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['payments'] } as Item)).toBe(true);
    expect(
      evaluateSmartView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(true);
    expect(evaluateSmartView(v, { tags: ['other'] } as Item)).toBe(false);
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(false);
  });

  it('combinator=any with untagged plus tag-includes accepts either branch', () => {
    const v = view(
      [{ kind: 'untagged' }, { kind: 'tag-includes', tag: 'incident' }],
      'any',
    );
    expect(evaluateSmartView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['incident'] } as Item)).toBe(true);
    expect(evaluateSmartView(v, { tags: ['other'] } as Item)).toBe(false);
  });
});
