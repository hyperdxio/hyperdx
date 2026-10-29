import {
  clampAlertDisplayName,
  clampAlertTags,
  formatTileAlertDisplayName,
} from '@/alerts';
import {
  MAX_ALERT_DISPLAY_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
} from '@/types';

describe('formatTileAlertDisplayName', () => {
  it('joins the dashboard and tile names', () => {
    expect(formatTileAlertDisplayName('Checkout', 'Error rate')).toBe(
      'Checkout - Error rate',
    );
  });

  it('falls back for a blank tile name', () => {
    expect(formatTileAlertDisplayName('Checkout', '  ')).toBe(
      'Checkout - Tile',
    );
  });
});

describe('clampAlertDisplayName', () => {
  it('truncates to the alert cap', () => {
    expect(
      clampAlertDisplayName('x'.repeat(MAX_ALERT_DISPLAY_NAME_LENGTH + 5)),
    ).toHaveLength(MAX_ALERT_DISPLAY_NAME_LENGTH);
  });
});

describe('clampAlertTags', () => {
  it('drops empties, truncates each tag, and caps the count', () => {
    const tags = [
      '',
      'a'.repeat(MAX_TAG_LENGTH + 1),
      ...Array(MAX_TAGS).fill('t'),
    ];
    const clamped = clampAlertTags(tags);
    expect(clamped).toHaveLength(MAX_TAGS);
    expect(clamped[0]).toBe('a'.repeat(MAX_TAG_LENGTH));
  });
});
