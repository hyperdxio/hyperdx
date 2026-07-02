import {
  __resetQueryStatsForTests,
  appendQueryEvent,
  clearQueryEvents,
  getSnapshot,
  QueryEvent,
  subscribe,
  updateQueryEvent,
} from '../queryStatsStore';

function makeEvent(
  id: string,
  overrides: Partial<QueryEvent> = {},
): QueryEvent {
  return {
    id,
    queryId: id,
    sql: 'SELECT 1',
    params: {},
    status: 'pending',
    startedAt: Date.now(),
    pathname: '/test',
    kind: 'query',
    ...overrides,
  };
}

describe('queryStatsStore', () => {
  beforeEach(() => {
    __resetQueryStatsForTests();
  });

  it('appends events in order', () => {
    appendQueryEvent(makeEvent('a'));
    appendQueryEvent(makeEvent('b'));
    expect(getSnapshot().map(e => e.id)).toEqual(['a', 'b']);
  });

  it('caps the buffer at 200 events, dropping the oldest', () => {
    for (let i = 0; i < 250; i++) appendQueryEvent(makeEvent(`e${i}`));
    const snap = getSnapshot();
    expect(snap).toHaveLength(200);
    expect(snap[0].id).toBe('e50');
    expect(snap[snap.length - 1].id).toBe('e249');
  });

  it('updateQueryEvent merges patch by id', () => {
    appendQueryEvent(makeEvent('a'));
    updateQueryEvent('a', { status: 'done', durationMs: 42 });
    const [event] = getSnapshot();
    expect(event.status).toBe('done');
    expect(event.durationMs).toBe(42);
  });

  it('updateQueryEvent on unknown id is a no-op', () => {
    appendQueryEvent(makeEvent('a'));
    const before = getSnapshot();
    updateQueryEvent('ghost', { status: 'done' });
    expect(getSnapshot()).toBe(before);
  });

  it('clearQueryEvents empties the buffer', () => {
    appendQueryEvent(makeEvent('a'));
    clearQueryEvents();
    expect(getSnapshot()).toEqual([]);
  });

  it('subscribe notifies listeners on changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);
    appendQueryEvent(makeEvent('a'));
    updateQueryEvent('a', { status: 'done' });
    clearQueryEvents();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    appendQueryEvent(makeEvent('b'));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a throwing listener does not break other listeners', () => {
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    subscribe(bad);
    subscribe(good);
    appendQueryEvent(makeEvent('a'));
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('getSnapshot returns a stable reference until a change happens', () => {
    appendQueryEvent(makeEvent('a'));
    const first = getSnapshot();
    const second = getSnapshot();
    expect(first).toBe(second);
    appendQueryEvent(makeEvent('b'));
    expect(getSnapshot()).not.toBe(first);
  });
});
