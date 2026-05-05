import { formatTimelineResponse } from '../formatTimelineResponse';

describe('formatTimelineResponse', () => {
  it('returns empty results for empty data', () => {
    const result = formatTimelineResponse({ data: [], meta: [] });
    expect(result.events).toEqual([]);
    expect(result.lanes).toEqual([]);
  });

  it('returns empty results for missing meta', () => {
    const result = formatTimelineResponse({ data: [{ ts: 1000 }] });
    expect(result.events).toEqual([]);
    expect(result.lanes).toEqual([]);
  });

  it('parses basic events with ts and label columns', () => {
    const result = formatTimelineResponse({
      data: [
        { ts: '2024-01-01 00:00:00', label: 'Deploy v1.0' },
        { ts: '2024-01-01 01:00:00', label: 'Deploy v1.1' },
      ],
      meta: [
        { name: 'ts', type: 'DateTime' },
        { name: 'label', type: 'String' },
      ],
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].label).toBe('Deploy v1.0');
    expect(result.events[1].label).toBe('Deploy v1.1');
    expect(result.events[0].ts).toBeGreaterThan(0);
    // Single lane since no group or __series column
    expect(result.lanes).toHaveLength(1);
    expect(result.lanes[0].key).toBe('_default');
    expect(result.lanes[0].displayName).toBe('Events');
    expect(result.lanes[0].events).toHaveLength(2);
  });

  it('creates lanes from group column', () => {
    const result = formatTimelineResponse({
      data: [
        { ts: '2024-01-01 00:00:00', label: 'Event A', group: 'ServiceA' },
        { ts: '2024-01-01 01:00:00', label: 'Event B', group: 'ServiceB' },
        { ts: '2024-01-01 02:00:00', label: 'Event C', group: 'ServiceA' },
      ],
      meta: [
        { name: 'ts', type: 'DateTime' },
        { name: 'label', type: 'String' },
        { name: 'group', type: 'String' },
      ],
    });

    expect(result.lanes).toHaveLength(2);
    expect(result.lanes[0].key).toBe('ServiceA');
    expect(result.lanes[0].events).toHaveLength(2);
    expect(result.lanes[1].key).toBe('ServiceB');
    expect(result.lanes[1].events).toHaveLength(1);
  });

  it('creates lanes from __series column (UNION ALL)', () => {
    const result = formatTimelineResponse({
      data: [
        {
          ts: '2024-01-01 00:00:00',
          label: 'Deploy',
          __series: 'deploys',
          group: 'svc1',
        },
        {
          ts: '2024-01-01 01:00:00',
          label: 'Warning',
          __series: 'k8s-events',
          group: 'pod1',
        },
      ],
      meta: [
        { name: 'ts', type: 'DateTime' },
        { name: 'label', type: 'String' },
        { name: '__series', type: 'String' },
        { name: 'group', type: 'String' },
      ],
    });

    // __series takes precedence over group for lane assignment
    expect(result.lanes).toHaveLength(2);
    expect(result.lanes[0].key).toBe('deploys');
    expect(result.lanes[1].key).toBe('k8s-events');
  });

  it('handles severity column', () => {
    const result = formatTimelineResponse({
      data: [
        {
          ts: '2024-01-01 00:00:00',
          label: 'Error event',
          severity: 'ERROR',
        },
      ],
      meta: [
        { name: 'ts', type: 'DateTime' },
        { name: 'label', type: 'String' },
        { name: 'severity', type: 'String' },
      ],
    });

    expect(result.events[0].severity).toBe('ERROR');
  });

  it('handles numeric timestamps (unix seconds)', () => {
    const result = formatTimelineResponse({
      data: [{ ts: 1704067200, label: 'Event' }],
      meta: [
        { name: 'ts', type: 'UInt64' },
        { name: 'label', type: 'String' },
      ],
    });

    expect(result.events[0].ts).toBe(1704067200);
  });

  it('handles numeric timestamps (unix milliseconds)', () => {
    const result = formatTimelineResponse({
      data: [{ ts: 1704067200000, label: 'Event' }],
      meta: [
        { name: 'ts', type: 'UInt64' },
        { name: 'label', type: 'String' },
      ],
    });

    // Should convert to seconds
    expect(result.events[0].ts).toBe(1704067200);
  });

  it('falls back to first DateTime column if no ts column', () => {
    const result = formatTimelineResponse({
      data: [{ TimestampTime: '2024-01-01 00:00:00', label: 'Event' }],
      meta: [
        { name: 'TimestampTime', type: 'DateTime64(9)' },
        { name: 'label', type: 'String' },
      ],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].ts).toBeGreaterThan(0);
  });

  it('assigns different colors to different lanes', () => {
    const result = formatTimelineResponse({
      data: [
        { ts: '2024-01-01 00:00:00', label: 'A', group: 'Lane1' },
        { ts: '2024-01-01 01:00:00', label: 'B', group: 'Lane2' },
      ],
      meta: [
        { name: 'ts', type: 'DateTime' },
        { name: 'label', type: 'String' },
        { name: 'group', type: 'String' },
      ],
    });

    expect(result.lanes[0].color).toBeDefined();
    expect(result.lanes[1].color).toBeDefined();
    expect(result.lanes[0].color).not.toBe(result.lanes[1].color);
  });
});
