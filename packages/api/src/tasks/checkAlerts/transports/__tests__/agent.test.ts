import mongoose from 'mongoose';

import { AlertState } from '@/models/alert';
import { startAgentSession } from '@/services/anthropicAgents';
import {
  buildAgentPrompt,
  handleStartAgentInvestigation,
} from '@/tasks/checkAlerts/transports/agent';
import type { Message } from '@/tasks/checkAlerts/transports/types';

jest.mock('@/services/anthropicAgents', () => ({
  startAgentSession: jest.fn(),
}));

// Unit runs don't load .env.test, so enable the feature flag explicitly. The
// namespace import is wrapped in getters, so the factory also exposes a setter
// closing over the underlying object for the flag-off test below.
jest.mock('@/config', () => {
  const mock: Record<string, unknown> & {
    IS_MANAGED_AGENTS_ENABLED: boolean;
    __setManagedAgentsEnabled?: (v: boolean) => void;
  } = {
    ...jest.requireActual<Record<string, unknown>>('@/config'),
    IS_MANAGED_AGENTS_ENABLED: true,
  };
  mock.__setManagedAgentsEnabled = (v: boolean) => {
    mock.IS_MANAGED_AGENTS_ENABLED = v;
  };
  return mock;
});

const startAgentSessionMock = jest.mocked(startAgentSession);

// The mock factory above attaches the setter; requireMock hands back that
// same (untyped) object.
const configMock: any = jest.requireMock('@/config');

const teamId = new mongoose.Types.ObjectId().toString();
const agentId = new mongoose.Types.ObjectId().toString();

const message: Message = {
  hdxLink: 'https://example.test/alert',
  title: '🚨 CPU high',
  body: '42 lines found',
  state: AlertState.ALERT,
  startTime: 1700000000000,
  endTime: 1700000300000,
  eventId: 'evt-1',
  alertId: 'alert-1',
  status: 'firing',
  alertType: 'search',
  comparator: '>=',
  threshold: 5,
  value: 42,
  groupKey: 'checkout',
  sourceQuery: 'Body: "error"',
  teamId,
  note: 'Runbook: https://wiki.example/runbook',
};

const agentChannel = { type: 'agent' as const, channel: { agentId } };

describe('buildAgentPrompt', () => {
  // "between 5" is not a condition. A range alert's upper bound has to reach
  // the agent or it cannot reconstruct what fired, let alone re-run it.
  it('carries the upper bound of a range condition', () => {
    const payload = JSON.parse(
      buildAgentPrompt({ ...message, comparator: 'between', thresholdMax: 9 }),
    );
    expect(payload.condition).toMatchObject({
      comparator: 'between',
      threshold: message.threshold,
      threshold_max: 9,
    });
  });

  it('omits the upper bound when the condition has none', () => {
    const payload = JSON.parse(buildAgentPrompt(message));
    expect(payload.condition).not.toHaveProperty('threshold_max');
  });

  it('serializes the alert context as structured JSON', () => {
    const payload = JSON.parse(buildAgentPrompt(message));
    expect(payload.source).toBe('clickstack');
    expect(payload.alert).toMatchObject({
      id: 'alert-1',
      event_id: 'evt-1',
      status: 'firing',
      type: 'search',
      title: '🚨 CPU high',
      link: 'https://example.test/alert',
    });
    expect(payload.condition).toEqual({
      comparator: '>=',
      threshold: 5,
      current_value: 42,
    });
    expect(payload.context).toMatchObject({
      group_key: 'checkout',
      source_query: 'Body: "error"',
      runbook: 'Runbook: https://wiki.example/runbook',
      team_id: teamId,
    });
    expect(payload.context.time_range).toEqual({
      start: new Date(1700000000000).toISOString(),
      end: new Date(1700000300000).toISOString(),
    });
  });
});

describe('handleStartAgentInvestigation', () => {
  beforeEach(() => {
    startAgentSessionMock.mockReset();
    // The transport only reads `deduped`; it never touches the run itself.
    startAgentSessionMock.mockResolvedValue({ run: null, deduped: false });
  });

  it('throws on a non-agent channel', async () => {
    const wrongChannel: any = { type: 'webhook' };
    await expect(
      handleStartAgentInvestigation(wrongChannel, message),
    ).rejects.toThrow('Unsupported channel type: webhook');
  });

  it('starts an investigation with the dedupe identifiers and the structured prompt', async () => {
    await handleStartAgentInvestigation(agentChannel, message);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    const args = startAgentSessionMock.mock.calls[0][0];
    expect(args.agentId).toBe(agentId);
    expect(args.teamId.toString()).toBe(teamId);
    expect(args.alertId).toBe('alert-1');
    expect(args.eventId).toBe('evt-1');
    expect(args.title).toBe('🚨 CPU high');
    expect(JSON.parse(args.prompt).alert.event_id).toBe('evt-1');
  });

  it('skips (no session) on a non-firing state', async () => {
    await handleStartAgentInvestigation(agentChannel, {
      ...message,
      state: AlertState.OK,
    });
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws when the message carries no teamId', async () => {
    await expect(
      handleStartAgentInvestigation(agentChannel, {
        ...message,
        teamId: undefined,
      }),
    ).rejects.toThrow(/no teamId/);
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it('propagates a session-start failure so it surfaces as a notification failure', async () => {
    startAgentSessionMock.mockRejectedValue(new Error('anthropic down'));
    await expect(
      handleStartAgentInvestigation(agentChannel, message),
    ).rejects.toThrow('anthropic down');
  });

  it('fails loudly when the deployment has managed agents disabled', async () => {
    configMock.__setManagedAgentsEnabled(false);
    try {
      await expect(
        handleStartAgentInvestigation(agentChannel, message),
      ).rejects.toThrow(/not enabled on this deployment/);
      expect(startAgentSessionMock).not.toHaveBeenCalled();
    } finally {
      configMock.__setManagedAgentsEnabled(true);
    }
  });
});
