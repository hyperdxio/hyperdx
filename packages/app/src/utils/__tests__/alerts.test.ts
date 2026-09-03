import { AlertSource } from '@hyperdx/common-utils/dist/types';

import {
  getAlertSourceLabel,
  normalizeNoOpAlertScheduleFields,
  toAlertChannels,
} from '@/utils/alerts';

// A channel shape this repo doesn't define -- e.g. a downstream fork's email
// channel, or a webhook channel carrying `webhookService`/`slackChannelId`/
// `severity`. `value: any` (rather than an `as` cast) keeps this off the
// no-unsafe-type-assertion budget while still producing a value typed as the
// generic channel type `toAlertChannels` accepts.
const foreignChannel = (value: any): { type?: string | null } => value;

describe('normalizeNoOpAlertScheduleFields', () => {
  it('drops no-op schedule fields for pre-migration alerts', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {},
    );

    expect(normalized).toEqual({});
  });

  it('treats undefined previous values as absent fields', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {
        scheduleOffsetMinutes: undefined,
        scheduleStartAt: undefined,
      },
    );

    expect(normalized).toEqual({});
  });

  it('keeps no-op fields when they were already persisted', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 0,
      scheduleStartAt: null,
    });
  });

  it('keeps non-default schedule fields', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 3,
        scheduleStartAt: '2024-01-01T00:00:00.000Z',
      },
      {},
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 3,
      scheduleStartAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('keeps an explicit offset reset when requested', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
      },
      undefined,
      {
        preserveExplicitScheduleOffsetMinutes: true,
      },
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 0,
    });
  });

  it('keeps an explicit start-at clear when requested', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleStartAt: null,
      },
      undefined,
      {
        preserveExplicitScheduleStartAt: true,
      },
    );

    expect(normalized).toEqual({
      scheduleStartAt: null,
    });
  });
});

describe('toAlertChannels', () => {
  const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

  it('prefers the channels array', () => {
    expect(
      toAlertChannels({ channel: wh('legacy'), channels: [wh('a'), wh('b')] }),
    ).toEqual([wh('a'), wh('b')]);
  });

  it('falls back to the legacy singular channel', () => {
    expect(toAlertChannels({ channel: wh('legacy') })).toEqual([wh('legacy')]);
    expect(toAlertChannels({ channel: wh('legacy'), channels: [] })).toEqual([
      wh('legacy'),
    ]);
  });

  it('always returns at least one row for the form to render', () => {
    expect(toAlertChannels()).toEqual([wh('')]);
    expect(toAlertChannels({})).toEqual([wh('')]);
    expect(toAlertChannels({ channel: { type: null } })).toEqual([wh('')]);
  });

  // The invariant guard: this repo only defines webhook channels, but a
  // downstream fork adds others. toAlertChannels must copy them by
  // reference, not project them onto webhook-shaped fields.
  it('keeps an email-shaped channel intact', () => {
    const exotic = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    expect(toAlertChannels({ channels: [exotic] })).toEqual([exotic]);
  });

  it('keeps webhookService, slackChannelId and severity on a webhook channel', () => {
    const exotic = foreignChannel({
      type: 'webhook',
      webhookId: 'w1',
      webhookService: 'slack',
      slackChannelId: 'C123',
      severity: 'critical',
    });

    expect(toAlertChannels({ channels: [exotic] })).toEqual([exotic]);
  });

  it('keeps both entries in a mixed webhook + email list', () => {
    const email = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    expect(toAlertChannels({ channels: [wh('a'), email] })).toEqual([
      wh('a'),
      email,
    ]);
  });
});

describe('getAlertSourceLabel', () => {
  it('names each source kind', () => {
    expect(getAlertSourceLabel({ source: AlertSource.SAVED_SEARCH })).toBe(
      'Saved search',
    );
    expect(getAlertSourceLabel({ source: AlertSource.TILE })).toBe(
      'Dashboard tile',
    );
  });

  // The row's tooltip, the alerts-page filter and free-text search all read
  // this, so an unresolvable source has to yield something printable rather
  // than undefined leaking into a label.
  it('falls back for a missing source', () => {
    expect(getAlertSourceLabel({})).toBe('Unknown source');
    expect(getAlertSourceLabel({ source: null })).toBe('Unknown source');
  });
});
