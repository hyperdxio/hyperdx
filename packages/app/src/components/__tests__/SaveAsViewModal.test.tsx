import { buildRulesFromFilters } from '../SaveAsViewModal';

describe('buildRulesFromFilters', () => {
  it('emits zero rules when no filter is active', () => {
    expect(
      buildRulesFromFilters({
        tags: [],
        recentDays: null,
        withAlerts: null,
        createdByMe: null,
      }),
    ).toEqual([]);
  });

  it('emits one tag-includes rule per selected tag, in input order', () => {
    expect(
      buildRulesFromFilters({
        tags: ['checkout', 'payments'],
        recentDays: null,
        withAlerts: null,
        createdByMe: null,
      }),
    ).toEqual([
      { kind: 'tag-includes', tag: 'checkout' },
      { kind: 'tag-includes', tag: 'payments' },
    ]);
  });

  it('emits an updated-within-days rule when recentDays is set', () => {
    expect(
      buildRulesFromFilters({
        tags: [],
        recentDays: 7,
        withAlerts: null,
        createdByMe: null,
      }),
    ).toEqual([{ kind: 'updated-within-days', days: 7 }]);
  });

  it('emits has-active-alerts and created-by-me when toggled', () => {
    expect(
      buildRulesFromFilters({
        tags: [],
        recentDays: null,
        withAlerts: true,
        createdByMe: true,
      }),
    ).toEqual([{ kind: 'has-active-alerts' }, { kind: 'created-by-me' }]);
  });

  it('mixes tag and non-tag rules', () => {
    expect(
      buildRulesFromFilters({
        tags: ['incident'],
        recentDays: 30,
        withAlerts: true,
        createdByMe: false,
      }),
    ).toEqual([
      { kind: 'tag-includes', tag: 'incident' },
      { kind: 'updated-within-days', days: 30 },
      { kind: 'has-active-alerts' },
    ]);
  });
});
