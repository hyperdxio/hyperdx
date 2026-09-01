import { Types } from 'mongoose';

import {
  type AlertChannel,
  type AlertDocument,
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
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

      const translated = translateAlertDocumentToExternalAlert(alert, {
        includeChartConfig: true,
      });

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

      const translated = translateAlertDocumentToExternalAlert(alert, {
        includeChartConfig: true,
      });

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

      const translated = translateAlertDocumentToExternalAlert(alert, {
        includeChartConfig: true,
      });

      expect(translated.chartConfig).toBeUndefined();
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

      const translated = translateAlertDocumentToExternalAlert(alert, {
        includeChartConfig: true,
      });

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
