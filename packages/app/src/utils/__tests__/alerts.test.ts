import {
  AlertSource,
  AlertThresholdType,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import type { AlertsPageItem } from '@/types';
import {
  buildInlineAlertPayload,
  getAlertSourceLabel,
  getAlertSourceUrl,
  getDerivedAlertDisplayName,
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
    expect(getAlertSourceLabel({ source: AlertSource.INLINE })).toBe('Chart');
  });

  // The row's tooltip, the alerts-page filter and free-text search all read
  // this, so an unresolvable source has to yield something printable rather
  // than undefined leaking into a label.
  it('falls back for a missing source', () => {
    expect(getAlertSourceLabel({})).toBe('Unknown source');
    expect(getAlertSourceLabel({ source: null })).toBe('Unknown source');
  });
});

// Only the fields the two helpers read; `any` keeps these off the
// no-unsafe-type-assertion budget without spelling out the full page item.
const asAlert = (partial: any): AlertsPageItem => partial;

describe('getDerivedAlertDisplayName', () => {
  it('formats a tile alert like the server does', () => {
    expect(
      getDerivedAlertDisplayName(
        asAlert({
          displayName: 'Custom',
          source: AlertSource.TILE,
          tileId: 'tile-1',
          dashboard: {
            name: 'Checkout',
            tiles: [{ id: 'tile-1', config: { name: 'Error rate' } }],
          },
        }),
      ),
    ).toBe('Checkout - Error rate');
  });

  it('falls back to a generic tile name', () => {
    expect(
      getDerivedAlertDisplayName(
        asAlert({
          source: AlertSource.TILE,
          tileId: 'tile-1',
          dashboard: { name: 'Checkout', tiles: [] },
        }),
      ),
    ).toBe('Checkout - Tile');
  });

  it('uses the saved search name', () => {
    expect(
      getDerivedAlertDisplayName(
        asAlert({
          source: AlertSource.SAVED_SEARCH,
          savedSearch: { name: 'Checkout 5xx' },
        }),
      ),
    ).toBe('Checkout 5xx');
  });

  // An inline alert references nothing, so the server derives its name from
  // the chart it carries.
  it('uses an inline alert’s chart name', () => {
    expect(
      getDerivedAlertDisplayName(
        asAlert({
          source: AlertSource.INLINE,
          chartConfig: { name: 'Error rate' },
        }),
      ),
    ).toBe('Error rate');
  });

  it('is undefined when the source is not embedded', () => {
    expect(
      getDerivedAlertDisplayName(asAlert({ source: AlertSource.SAVED_SEARCH })),
    ).toBeUndefined();
    // The alerts list omits chartConfig, so a row cannot derive one either.
    expect(
      getDerivedAlertDisplayName(asAlert({ source: AlertSource.INLINE })),
    ).toBeUndefined();
  });
});

const inlineChartConfig = {
  name: 'Error rate',
  source: 'source-1',
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count' as const, aggCondition: '', valueExpression: '' }],
  where: '',
};

const inlineAlert = (overrides: Partial<AlertsPageItem> = {}): AlertsPageItem =>
  ({
    _id: 'alert-1',
    source: AlertSource.INLINE,
    interval: '5m',
    threshold: 1,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook', webhookId: 'hook-1' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
    ...overrides,
  }) as AlertsPageItem;

describe('getAlertSourceUrl', () => {
  // By id, not by an inlined config: the alerts list omits chartConfig, so a
  // config-carrying link would leave every list row without one.
  it('links an inline alert to the chart explorer by id', () => {
    expect(
      getAlertSourceUrl(inlineAlert({ chartConfig: inlineChartConfig })),
    ).toBe('/chart?alertId=alert-1');
    expect(getAlertSourceUrl(inlineAlert())).toBe('/chart?alertId=alert-1');
  });
});

describe('buildInlineAlertPayload', () => {
  const alert = {
    interval: '5m' as const,
    threshold: 10,
    thresholdType: AlertThresholdType.ABOVE,
    channels: [{ type: 'webhook' as const, webhookId: 'hook-1' }],
  };

  it('splits the alert off the chart config', () => {
    const payload = buildInlineAlertPayload({
      ...inlineChartConfig,
      alert: { ...alert, name: 'Prod errors' },
    });

    expect(payload).toMatchObject({
      source: AlertSource.INLINE,
      threshold: 10,
      name: 'Prod errors',
      chartConfig: inlineChartConfig,
    });
    // The alert must not be persisted inside its own chart config: the
    // evaluator reads the alert's fields off the alert document.
    expect(payload?.chartConfig).not.toHaveProperty('alert');
  });

  // The name doubles as the notification title, so a blank field takes the
  // chart's name rather than sending an empty one.
  it('defaults the name to the chart name', () => {
    expect(buildInlineAlertPayload({ ...inlineChartConfig, alert })?.name).toBe(
      'Error rate',
    );
    expect(
      buildInlineAlertPayload({
        ...inlineChartConfig,
        alert: { ...alert, name: null },
      })?.name,
    ).toBe('Error rate');
  });

  it('returns nothing when there is no alert to save', () => {
    expect(buildInlineAlertPayload(inlineChartConfig)).toBeUndefined();
  });

  // PromQL charts cannot be alerted on: the inline-alert schema has no PromQL
  // variant, so a payload built from one would be rejected server-side.
  it('returns nothing for a PromQL chart', () => {
    expect(
      buildInlineAlertPayload({
        configType: 'promql',
        promqlExpression: 'up',
        connection: 'conn-1',
        displayType: DisplayType.Line,
        alert,
      }),
    ).toBeUndefined();
  });
});
