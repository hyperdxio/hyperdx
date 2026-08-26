import {
  AlertChartConfig,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { makeAlert } from '@/controllers/alerts';
import { AlertChannel, AlertSource, AlertThresholdType } from '@/models/alert';

// A channel type this repo doesn't define -- see
// models/__tests__/alert.test.ts for why. `value: any` (rather than an `as`
// cast) keeps this off the no-unsafe-type-assertion budget while still
// producing a value typed as AlertChannel for the call below.
const foreignChannel = (value: any): AlertChannel => value;

describe('makeAlert', () => {
  // makeAlert mirrors channels[0] into `channel` for readers that predate
  // multi-channel support. That mirroring must stay opaque: a downstream
  // fork's channel types must survive verbatim, not get projected onto
  // webhook-shaped fields.
  it('mirrors channels[0] into channel verbatim, preserving fields this repo does not define', () => {
    const exotic = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    const result = makeAlert({
      interval: '5m',
      threshold: 1,
      thresholdType: AlertThresholdType.ABOVE,
      channels: [exotic],
    });

    expect(result.channel).toEqual(exotic);
    expect(result.channels).toEqual([exotic]);
  });

  const chartConfig: AlertChartConfig = {
    name: 'Errors',
    source: 'source-id',
    displayType: DisplayType.Line,
    select: [
      {
        aggFn: 'count',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: '',
      },
    ],
    where: '',
    whereLanguage: 'lucene',
  };

  it('persists chartConfig for chart alerts and clears the other source references', () => {
    const result = makeAlert({
      interval: '5m',
      threshold: 1,
      thresholdType: AlertThresholdType.ABOVE,
      channels: [{ type: 'webhook', webhookId: 'webhook-id' }],
      source: AlertSource.CHART,
      chartConfig,
    });

    expect(result.chartConfig).toEqual(chartConfig);
    expect(result.savedSearch).toBeNull();
    expect(result.groupBy).toBeNull();
    expect(result.dashboard).toBeNull();
    expect(result.tileId).toBeNull();
  });

  it('clears chartConfig when the alert source is not chart', () => {
    // Converting a chart alert to another source must not leave the old
    // config behind (mirrors how savedSearch/dashboard references clear).
    const result = makeAlert({
      interval: '5m',
      threshold: 1,
      thresholdType: AlertThresholdType.ABOVE,
      channels: [{ type: 'webhook', webhookId: 'webhook-id' }],
      source: AlertSource.SAVED_SEARCH,
      savedSearchId: 'saved-search-id',
      chartConfig,
    });

    expect(result.chartConfig).toBeNull();
    expect(result.savedSearch).toBe('saved-search-id');
  });
});
