import { Types } from 'mongoose';

import {
  AlertChangeType,
  AlertConditionType,
  type AlertDocument,
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import { translateAlertDocumentToExternalAlert } from '@/utils/externalApi';

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

    it('includes conditionType and changeType for rate-of-change alerts', () => {
      const alert = createAlertDocument({
        conditionType: AlertConditionType.RATE_OF_CHANGE,
        changeType: AlertChangeType.PERCENTAGE,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.conditionType).toBe(AlertConditionType.RATE_OF_CHANGE);
      expect(translated.changeType).toBe(AlertChangeType.PERCENTAGE);
    });

    it('includes conditionType for threshold alerts', () => {
      const alert = createAlertDocument({
        conditionType: AlertConditionType.THRESHOLD,
      });

      const translated = translateAlertDocumentToExternalAlert(alert);

      expect(translated.conditionType).toBe(AlertConditionType.THRESHOLD);
      expect(translated.changeType).toBeUndefined();
    });
  });
});
