import { evaluateListView } from '../evaluateListView';

type Item = { tags: string[] };

const view = (
  rules: Parameters<typeof evaluateListView>[0]['rules'],
  combinator: 'all' | 'any' = 'all',
) => ({ rules, combinator });

describe('evaluateListView', () => {
  it('matches every item when the rule list is empty', () => {
    const v = view([]);
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['anything'] } as Item)).toBe(true);
  });

  it('tag-includes passes only when the item carries that tag', () => {
    const v = view([{ kind: 'tag-includes', tag: 'checkout' }]);
    expect(evaluateListView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(
      evaluateListView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(true);
    expect(evaluateListView(v, { tags: ['payments'] } as Item)).toBe(false);
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(false);
  });

  it('tag-excludes passes when the item does not carry that tag', () => {
    const v = view([{ kind: 'tag-excludes', tag: 'payments' }]);
    expect(evaluateListView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['payments'] } as Item)).toBe(false);
    expect(
      evaluateListView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(false);
  });

  it('untagged passes only when the item has zero tags', () => {
    const v = view([{ kind: 'untagged' }]);
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['anything'] } as Item)).toBe(false);
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
    expect(evaluateListView(v, { tags: ['checkout'] } as Item)).toBe(true);
    // Has checkout but also payments -> the second rule fails
    expect(
      evaluateListView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(false);
    // No checkout -> first rule fails
    expect(evaluateListView(v, { tags: ['payments'] } as Item)).toBe(false);
  });

  it('combinator=any passes when at least one rule passes', () => {
    const v = view(
      [
        { kind: 'tag-includes', tag: 'checkout' },
        { kind: 'tag-includes', tag: 'payments' },
      ],
      'any',
    );
    expect(evaluateListView(v, { tags: ['checkout'] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['payments'] } as Item)).toBe(true);
    expect(
      evaluateListView(v, { tags: ['checkout', 'payments'] } as Item),
    ).toBe(true);
    expect(evaluateListView(v, { tags: ['other'] } as Item)).toBe(false);
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(false);
  });

  it('combinator=any with untagged plus tag-includes accepts either branch', () => {
    const v = view(
      [{ kind: 'untagged' }, { kind: 'tag-includes', tag: 'incident' }],
      'any',
    );
    expect(evaluateListView(v, { tags: [] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['incident'] } as Item)).toBe(true);
    expect(evaluateListView(v, { tags: ['other'] } as Item)).toBe(false);
  });

  it('treats a view with missing rules / combinator as match-all instead of crashing', () => {
    // Defensive: an older ListView document persisted before the
    // local-mode defaults landed may have `rules` or `combinator`
    // undefined. The evaluator must not blow up on either.
    const undefinedView = {} as Parameters<typeof evaluateListView>[0];
    expect(evaluateListView(undefinedView, { tags: [] } as Item)).toBe(true);
    expect(evaluateListView(undefinedView, { tags: ['any'] } as Item)).toBe(
      true,
    );

    const nullRulesView = {
      rules: null as unknown as Parameters<typeof evaluateListView>[0]['rules'],
      combinator: 'all' as const,
    };
    expect(evaluateListView(nullRulesView, { tags: [] } as Item)).toBe(true);
  });
});
