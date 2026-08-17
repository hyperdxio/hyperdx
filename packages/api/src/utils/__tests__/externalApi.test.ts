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
  });
});
