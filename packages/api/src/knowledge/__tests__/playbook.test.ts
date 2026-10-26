import { buildPlaybook } from '@/knowledge/incidents/playbook';
import type { ActionRow, IncidentRow } from '@/knowledge/incidents/types';

const incident: IncidentRow = {
  incident_id: 'i1',
  title: 't',
  status: 'resolved',
  opened_at: '2026-01-01 00:00:00',
  resolved_at: '2026-01-01 01:00:00',
  alerting_node: 'service:web',
  root_cause_node: 'service:checkout',
  root_cause: 'bad deploy',
  resolution: 'rolled back',
  symptom_keys: [],
  summary: '',
  embedding: [],
  confirmed_by: 'u',
  version: 1,
  path: '',
};

const action = (seq: number, outcome: ActionRow['outcome'], args = '{}') =>
  ({
    incident_id: 'i1',
    seq,
    ts: '2026-01-01 00:00:00',
    actor: 'agent',
    action_type: 'query',
    tool: 'clickstack_search',
    args,
    reason: `reason ${seq}`,
    outcome,
    summary: `summary ${seq}`,
  }) as ActionRow;

describe('buildPlaybook', () => {
  it('keeps useful and led_to_fix steps in order and lists dead ends', () => {
    const p = buildPlaybook(incident, [
      action(4, 'led_to_fix'),
      action(1, 'unknown'),
      action(3, 'dead_end'),
      action(2, 'useful'),
    ]);
    expect(p.steps.map(s => [s.seq, s.outcome])).toEqual([
      [2, 'useful'],
      [4, 'led_to_fix'],
    ]);
    expect(p.ruledOut).toEqual([{ seq: 3, summary: 'summary 3' }]);
    expect(p).toMatchObject({
      incidentId: 'i1',
      rootCause: 'bad deploy',
      rootCauseNode: 'service:checkout',
      resolution: 'rolled back',
    });
  });

  it('sorts ruled out by seq', () => {
    const p = buildPlaybook(incident, [
      action(5, 'dead_end'),
      action(2, 'dead_end'),
    ]);
    expect(p.ruledOut.map(r => r.seq)).toEqual([2, 5]);
  });

  it('parses args JSON objects', () => {
    const p = buildPlaybook(incident, [action(1, 'useful', '{"a":1}')]);
    expect(p.steps[0].args).toEqual({ a: 1 });
  });

  it.each(['{not json', '', '42', '[1,2]', 'null'])(
    'turns args %j into {}',
    args => {
      const p = buildPlaybook(incident, [action(1, 'useful', args)]);
      expect(p.steps[0].args).toEqual({});
    },
  );
});
