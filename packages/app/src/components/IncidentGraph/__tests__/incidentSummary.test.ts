import { incidentRoute } from '@/components/IncidentGraph/IncidentList';
import { resolvedAfter } from '@/components/IncidentGraph/IncidentSummary';
import type { KgIncident } from '@/components/IncidentGraph/types';

const incident = (o: Partial<KgIncident> = {}): KgIncident => ({
  incidentId: 'a',
  title: 'Checkout errors',
  status: 'resolved',
  confirmed: true,
  confirmedBy: 'user-1',
  alertingNode: 'service:edge-gateway',
  rootCauseNode: 'datastore:postgresql:db',
  rootCause: 'Pool exhausted',
  resolution: 'Raised the pool size',
  openedAt: '2026-10-26 01:00:00.000',
  resolvedAt: '2026-10-26 01:02:30.000',
  ...o,
});

describe('resolvedAfter', () => {
  it('gives the time from open to resolve', () => {
    expect(resolvedAfter(incident())).toBe('2.5min');
    expect(
      resolvedAfter(incident({ resolvedAt: '2026-10-26 01:00:00.200' })),
    ).toBe('under a second');
    expect(resolvedAfter(incident({ resolvedAt: null }))).toBeNull();
  });
});

describe('incidentRoute', () => {
  it('names the alerting and root cause nodes', () => {
    expect(incidentRoute(incident())).toBe(
      'Alerted on edge-gateway, root cause postgresql:db',
    );
    expect(incidentRoute(incident({ rootCauseNode: '' }))).toBe(
      'Alerted on edge-gateway',
    );
  });
});
