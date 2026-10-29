import { Types } from 'mongoose';

import {
  type AlertChannel,
  type AlertDocument,
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import { translateAlertDocumentToExternalAlertWithChartConfig } from '@/routers/external-api/v2/utils/alertChartConfig';
import { translateAlertDocumentToExternalAlert } from '@/utils/externalApi';

// A channel type this repo doesn't define -- see
// models/__tests__/alert.test.ts for why. `value: any` (rather than an `as`
// cast) keeps this off the no-unsafe-type-assertion budget while still
// producing a value typed as AlertChannel for the call below.
const foreignChannel = (value: any): AlertChannel => value;

const createAlertDocument = (
  overrides: Partial<Record<string, unknown>> = {},
): AlertDocument =>
  ({
    _id: new Types.ObjectId(),
    team: new Types.ObjectId(),
    threshold: 5,
    interval: '5m',
    thresholdType: AlertThresholdType.ABOVE,
    source: AlertSource.SAVED_SEARCH,
    state: AlertState.OK,
    channel: { type: null },
    ...overrides,
  }) as unknown as AlertDocument;

describe('utils/externalApi', () => {
  describe('translateAlertDocumentToExternalAlert', () => {
    it('returns scheduleStartAt as null when explicitly cleared', () => {
      const alert = createAlertDocument({
        scheduleStartAt: null,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.scheduleStartAt).toBeNull();
    });

    it('returns scheduleStartAt as undefined when the value is missing', () => {
      const alert = createAlertDocument({
        scheduleStartAt: undefined,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.scheduleStartAt).toBeUndefined();
    });
  });

  describe('displayName and tags', () => {
    it('passes stored values through', () => {
      const alert = createAlertDocument({
        displayName: 'Checkout errors',
        tags: ['checkout'],
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.displayName).toBe('Checkout errors');
      expect(translated.tags).toEqual(['checkout']);
    });

    it('derives from a populated saved search when unset', () => {
      const alert = createAlertDocument({
        savedSearch: {
          _id: new Types.ObjectId(),
          name: 'Payment 5xx',
          tags: ['payments'],
        },
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.displayName).toBe('Payment 5xx');
      expect(translated.tags).toEqual(['payments']);
    });

    it('derives from a populated dashboard tile when unset', () => {
      const alert = createAlertDocument({
        source: AlertSource.TILE,
        tileId: 'tile-1',
        savedSearch: undefined,
        dashboard: {
          _id: new Types.ObjectId(),
          name: 'Checkout',
          tags: ['team-checkout'],
          tiles: [{ id: 'tile-1', config: { name: 'Error rate' } }],
        },
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.displayName).toBe('Checkout - Error rate');
      expect(translated.tags).toEqual(['team-checkout']);
    });

    it('falls back when the refs are unpopulated and the fields are unset', () => {
      const alert = createAlertDocument({ savedSearch: new Types.ObjectId() });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.displayName).toBe('Alert');
      expect(translated.tags).toEqual([]);
    });

    it('derives from an inline chart config when unset', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        savedSearch: undefined,
        chartConfig: { name: 'p99 latency' },
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      // Inline alerts have no parent entity, so tags stay empty rather than
      // resolving to the generic fallback.
      expect(translated.displayName).toBe('p99 latency');
      expect(translated.tags).toEqual([]);
    });

    it('falls back for an inline alert whose chart config has no name', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        savedSearch: undefined,
        chartConfig: { displayType: 'line' },
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.displayName).toBe('Alert');
      expect(translated.tags).toEqual([]);
    });

    // A populated ref is a document, and documents don't override toString();
    // stringifying one directly yields "[object Object]".
    it('stringifies ids from populated refs', () => {
      const savedSearchId = new Types.ObjectId();
      const dashboardId = new Types.ObjectId();
      const alert = createAlertDocument({
        savedSearch: { _id: savedSearchId, name: 'S', tags: [] },
        dashboard: { _id: dashboardId, name: 'D', tags: [], tiles: [] },
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.savedSearchId).toBe(savedSearchId.toString());
      expect(translated.dashboardId).toBe(dashboardId.toString());
    });
  });

  describe('note handling', () => {
    it('returns note as null when the value is null', () => {
      const alert = createAlertDocument({ note: null });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.note).toBeNull();
    });

    it('returns note as null when the value is undefined', () => {
      const alert = createAlertDocument({ note: undefined });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.note).toBeNull();
    });

    it('returns note when the value is a non-empty string', () => {
      const alert = createAlertDocument({ note: 'threshold raised to 100' });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.note).toBe('threshold raised to 100');
    });
  });

  describe('numConsecutiveWindows handling', () => {
    it('returns numConsecutiveWindows as null when the value is null', () => {
      const alert = createAlertDocument({ numConsecutiveWindows: null });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.numConsecutiveWindows).toBeNull();
    });

    it('returns numConsecutiveWindows as null when the value is undefined', () => {
      const alert = createAlertDocument({ numConsecutiveWindows: undefined });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.numConsecutiveWindows).toBeNull();
    });

    it('returns numConsecutiveWindows when the value is a positive integer', () => {
      const alert = createAlertDocument({ numConsecutiveWindows: 3 });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.numConsecutiveWindows).toBe(3);
    });
  });

  describe('chartConfig handling', () => {
    const internalChartConfig = {
      displayType: 'line',
      source: '65f5e4a3b9e77c001a123456',
      select: [
        {
          aggFn: 'count',
          aggCondition: 'level:error',
          aggConditionLanguage: 'lucene',
          valueExpression: '',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      seriesReturnType: 'ratio',
    };

    it('omits chartConfig by default (list responses stay lean)', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        chartConfig: internalChartConfig,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.chartConfig).toBeUndefined();
      expect('chartConfig' in translated).toBe(false);
    });

    it('emits chartConfig in the external tile-config dialect when requested', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        chartConfig: internalChartConfig,
      });

      const translated =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      // seriesReturnType 'ratio' becomes asRatio only with exactly two
      // select items — this single-select config maps to false.
      expect(translated.chartConfig).toMatchObject({
        displayType: 'line',
        sourceId: '65f5e4a3b9e77c001a123456',
        asRatio: false,
        select: [
          {
            aggFn: 'count',
            where: 'level:error',
            whereLanguage: 'lucene',
          },
        ],
      });
    });

    it('emits raw SQL chartConfig with external field names', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        chartConfig: {
          configType: 'sql',
          displayType: 'line',
          sqlTemplate: 'SELECT 1',
          connection: '65f5e4a3b9e77c001a789012',
          source: '65f5e4a3b9e77c001a123456',
        },
      });

      const translated =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      expect(translated.chartConfig).toMatchObject({
        configType: 'sql',
        displayType: 'line',
        sqlTemplate: 'SELECT 1',
        connectionId: '65f5e4a3b9e77c001a789012',
        sourceId: '65f5e4a3b9e77c001a123456',
      });
    });

    it('does not emit chartConfig for non-inline alerts even when requested', () => {
      const alert = createAlertDocument({
        source: AlertSource.TILE,
        chartConfig: internalChartConfig,
      });

      const translated =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      expect(translated.chartConfig).toBeUndefined();
    });

    it('does not throw on an inline alert missing its chartConfig', () => {
      // Reachable via a direct DB write or a partial legacy document; the
      // translate layer must not crash a whole list response over one row.
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        chartConfig: null,
      });

      const translated =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      expect(translated.chartConfig).toBeUndefined();
      expect('chartConfig' in translated).toBe(false);
    });

    it('omits chartConfig when the persisted config has no external representation', () => {
      const alert = createAlertDocument({
        source: AlertSource.INLINE,
        chartConfig: {
          configType: 'promql',
          promqlQuery: 'up',
          source: '65f5e4a3b9e77c001a123456',
        },
      });

      const translated =
        translateAlertDocumentToExternalAlertWithChartConfig(alert);

      expect(translated.chartConfig).toBeUndefined();
    });
  });

  describe('channel mirroring', () => {
    // translateAlertDocumentToExternalAlert mirrors channels[0] into
    // `channel`, same as makeAlert (controllers/__tests__/alerts.test.ts).
    // That mirroring must stay opaque: a downstream fork's channel types
    // must survive verbatim, not get projected onto webhook-shaped fields.
    it('mirrors channels[0] into channel verbatim, preserving fields this repo does not define', () => {
      const exotic = foreignChannel({
        type: 'email',
        emailRecipients: ['ops@example.test'],
      });
      const alert = createAlertDocument({
        channel: undefined,
        channels: [exotic],
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.channel).toEqual(exotic);
      expect(translated.channels).toEqual([exotic]);
    });

    // A legacy `{type: null}` channel is a real, persistable state older
    // fixtures exercise, but it satisfies neither the `AlertChannels`
    // (minItems: 1) nor the `AlertChannel` oneOf in openapi.json. Omit both
    // fields rather than emit a shape that contradicts this API's own
    // contract.
    it('omits channel and channels when no channel resolves', () => {
      const alert = createAlertDocument({
        channel: { type: null },
        channels: undefined,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.channel).toBeUndefined();
      expect(translated.channels).toBeUndefined();
      expect('channel' in translated).toBe(false);
      expect('channels' in translated).toBe(false);
    });
  });
});
