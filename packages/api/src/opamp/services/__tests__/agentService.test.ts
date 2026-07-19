// --- mocks (hoisted; names must be prefixed with `mock`) ---
const mockSpanAttrs: Record<string, unknown> = {};
const mockCounterAdds: Record<string, unknown[][]> = {};

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () => ({
      setAttribute: (key: string, value: unknown) => {
        mockSpanAttrs[key] = value;
      },
    }),
  },
}));
jest.mock('@/utils/instrumentation', () => ({
  getCounter: (name: string) => ({
    add: (...args: unknown[]) => {
      (mockCounterAdds[name] ??= []).push(args);
    },
  }),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

import { agentService } from '@/opamp/services/agentService';

const APPLICATIONS = 'hyperdx.opamp.remote_config_applications';
const STATUS_REPORTS = 'hyperdx.opamp.agent_status_reports';

// Unique instanceUid per test avoids cross-test bleed in the shared agentStore.
const uid = (name: string) => Buffer.from(`test-${name}`);

const reset = () => {
  for (const k of Object.keys(mockSpanAttrs)) delete mockSpanAttrs[k];
  for (const k of Object.keys(mockCounterAdds)) delete mockCounterAdds[k];
};

describe('AgentService.processAgentStatus', () => {
  beforeEach(reset);

  it('marks a first-contact agent as new with no sequence gap', () => {
    agentService.processAgentStatus({
      instanceUid: uid('new'),
      sequenceNum: 1,
      capabilities: 1,
    });
    expect(mockSpanAttrs['opamp.agent.is_new']).toBe(true);
    expect(mockSpanAttrs['opamp.agent.sequence_gap']).toBeUndefined();
    expect(mockCounterAdds[STATUS_REPORTS]).toContainEqual([
      1,
      { status: 'new' },
    ]);
  });

  it('records the sequence gap between consecutive reports', () => {
    const id = uid('gap');
    agentService.processAgentStatus({
      instanceUid: id,
      sequenceNum: 5,
      capabilities: 1,
    });
    reset();
    agentService.processAgentStatus({
      instanceUid: id,
      sequenceNum: 8,
      capabilities: 1,
    });
    expect(mockSpanAttrs['opamp.agent.is_new']).toBe(false);
    expect(mockSpanAttrs['opamp.agent.sequence_gap']).toBe(3);
  });

  it('counts remote-config apply outcomes only on status transitions', () => {
    const id = uid('cfg');
    // APPLYING -> APPLIED -> APPLIED(heartbeat)
    agentService.processAgentStatus({
      instanceUid: id,
      sequenceNum: 1,
      capabilities: 1,
      remoteConfigStatus: { status: 2 },
    });
    agentService.processAgentStatus({
      instanceUid: id,
      sequenceNum: 2,
      capabilities: 1,
      remoteConfigStatus: { status: 1 },
    });
    agentService.processAgentStatus({
      instanceUid: id,
      sequenceNum: 3,
      capabilities: 1,
      remoteConfigStatus: { status: 1 },
    });
    // The repeated APPLIED heartbeat must not add a third data point.
    expect(mockCounterAdds[APPLICATIONS]).toEqual([
      [1, { status: 'APPLYING' }],
      [1, { status: 'APPLIED' }],
    ]);
  });

  it('counts UNSET (enum 0) and buckets unknown values (bounded label)', () => {
    agentService.processAgentStatus({
      instanceUid: uid('unset'),
      sequenceNum: 1,
      capabilities: 1,
      remoteConfigStatus: { status: 0 },
    });
    agentService.processAgentStatus({
      instanceUid: uid('unknown'),
      sequenceNum: 1,
      capabilities: 1,
      remoteConfigStatus: { status: 99 },
    });
    expect(mockCounterAdds[APPLICATIONS]).toContainEqual([
      1,
      { status: 'UNSET' },
    ]);
    expect(mockCounterAdds[APPLICATIONS]).toContainEqual([
      1,
      { status: 'unknown' },
    ]);
  });
});
