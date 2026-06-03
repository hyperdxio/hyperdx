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

  describe('updated-within-days', () => {
    const NOW = Date.parse('2026-06-03T00:00:00.000Z');
    let nowSpy: jest.SpyInstance;

    beforeEach(() => {
      nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });
    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('passes items updated within the window', () => {
      const v = view([{ kind: 'updated-within-days', days: 7 }]);
      // Updated 1 day ago -> passes
      expect(
        evaluateListView(v, {
          tags: [],
          updatedAt: new Date(NOW - 1 * 86_400_000).toISOString(),
        }),
      ).toBe(true);
      // Updated 6 days ago -> still inside the 7-day window
      expect(
        evaluateListView(v, {
          tags: [],
          updatedAt: new Date(NOW - 6 * 86_400_000).toISOString(),
        }),
      ).toBe(true);
    });

    it('rejects items older than the window', () => {
      const v = view([{ kind: 'updated-within-days', days: 7 }]);
      // 8 days ago -> outside the window
      expect(
        evaluateListView(v, {
          tags: [],
          updatedAt: new Date(NOW - 8 * 86_400_000).toISOString(),
        }),
      ).toBe(false);
    });

    it('rejects items with missing or unparseable updatedAt', () => {
      const v = view([{ kind: 'updated-within-days', days: 7 }]);
      expect(evaluateListView(v, { tags: [] })).toBe(false);
      expect(evaluateListView(v, { tags: [], updatedAt: 'not-a-date' })).toBe(
        false,
      );
    });
  });

  describe('has-active-alerts', () => {
    it('uses the caller-provided context flag', () => {
      const v = view([{ kind: 'has-active-alerts' }]);
      expect(
        evaluateListView(v, { tags: [] }, { itemHasActiveAlerts: true }),
      ).toBe(true);
      expect(
        evaluateListView(v, { tags: [] }, { itemHasActiveAlerts: false }),
      ).toBe(false);
    });

    it('rejects when no context is provided (no alert info available)', () => {
      const v = view([{ kind: 'has-active-alerts' }]);
      expect(evaluateListView(v, { tags: [] })).toBe(false);
    });
  });

  describe('created-by-me', () => {
    it('matches on createdBy._id when the user id is in context', () => {
      const v = view([{ kind: 'created-by-me' }]);
      expect(
        evaluateListView(
          v,
          { tags: [], createdBy: { _id: 'u-1', email: 'a@b' } },
          { currentUserId: 'u-1' },
        ),
      ).toBe(true);
    });

    it('falls back to email comparison when _id is missing', () => {
      const v = view([{ kind: 'created-by-me' }]);
      expect(
        evaluateListView(
          v,
          { tags: [], createdBy: { email: 'a@b' } },
          { currentUserEmail: 'a@b' },
        ),
      ).toBe(true);
    });

    it('rejects when neither _id nor email matches', () => {
      const v = view([{ kind: 'created-by-me' }]);
      expect(
        evaluateListView(
          v,
          { tags: [], createdBy: { _id: 'u-2', email: 'b@c' } },
          { currentUserId: 'u-1', currentUserEmail: 'a@b' },
        ),
      ).toBe(false);
    });

    it('rejects when the item has no createdBy at all', () => {
      const v = view([{ kind: 'created-by-me' }]);
      expect(
        evaluateListView(
          v,
          { tags: [], createdBy: null },
          { currentUserId: 'u-1' },
        ),
      ).toBe(false);
    });
  });
});
