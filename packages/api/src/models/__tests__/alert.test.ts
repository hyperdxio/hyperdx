import { getAlertChannels } from '@/models/alert';

describe('getAlertChannels', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  it('prefers the channels array when present', () => {
    expect(
      getAlertChannels({ channel: wh('legacy'), channels: [wh('a'), wh('b')] }),
    ).toEqual([wh('a'), wh('b')]);
  });

  it('falls back to the legacy singular channel', () => {
    expect(getAlertChannels({ channel: wh('legacy') })).toEqual([wh('legacy')]);
    expect(getAlertChannels({ channel: wh('legacy'), channels: [] })).toEqual([
      wh('legacy'),
    ]);
  });

  it('returns empty for null-type or missing channels', () => {
    expect(getAlertChannels({ channel: { type: null } })).toEqual([]);
    expect(getAlertChannels({})).toEqual([]);
  });
});
