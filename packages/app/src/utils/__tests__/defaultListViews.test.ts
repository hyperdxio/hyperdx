import {
  getDefaultListViews,
  isSystemViewId,
  SYSTEM_VIEW_ID_PREFIX,
} from '../defaultListViews';

describe('getDefaultListViews', () => {
  it('returns the four pinned system views for dashboards', () => {
    const views = getDefaultListViews('dashboard');
    expect(views).toHaveLength(4);
    expect(views.map(v => v.id)).toEqual([
      'system:created-by-me',
      'system:recent-7d',
      'system:has-active-alerts',
      'system:untagged',
    ]);
    expect(views.every(v => v.id.startsWith(SYSTEM_VIEW_ID_PREFIX))).toBe(true);
    expect(views.every(v => v.resource === 'dashboard')).toBe(true);
  });

  it('drops has-active-alerts for saved-search resource', () => {
    const views = getDefaultListViews('savedSearch');
    expect(views.map(v => v.id)).toEqual([
      'system:created-by-me',
      'system:recent-7d',
      'system:untagged',
    ]);
    expect(views.every(v => v.resource === 'savedSearch')).toBe(true);
  });

  it('seeds the recent view with a 7-day window', () => {
    const recent = getDefaultListViews('dashboard').find(
      v => v.id === 'system:recent-7d',
    );
    expect(recent?.rules).toEqual([{ kind: 'updated-within-days', days: 7 }]);
  });
});

describe('isSystemViewId', () => {
  it('recognises system ids', () => {
    expect(isSystemViewId('system:created-by-me')).toBe(true);
    expect(isSystemViewId('system:anything')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isSystemViewId(null)).toBe(false);
    expect(isSystemViewId(undefined)).toBe(false);
    expect(isSystemViewId('')).toBe(false);
    expect(isSystemViewId('user-view-123')).toBe(false);
    expect(isSystemViewId('SYSTEM:created-by-me')).toBe(false);
  });
});
