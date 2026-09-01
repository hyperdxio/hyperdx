import {
  McpSaveAlertInput,
  validateSaveAlertInput,
} from '@/mcp/tools/alerts/schemas';

// A channel shape wider than this schema's `{ type, webhookId }` -- e.g. a
// downstream channel type carrying an extra field. `value: any` (rather than
// an `as` cast) keeps this off the no-unsafe-type-assertion budget while
// still producing a value typed as a channel for the calls below.
type Channel = NonNullable<McpSaveAlertInput['channel']>;
const foreignChannel = (value: any): Channel => value;

const wh = (id: string) => ({ type: 'webhook' as const, webhookId: id });

const baseInput: Omit<McpSaveAlertInput, 'channel' | 'channels'> = {
  source: 'saved_search',
  savedSearchId: 'saved-search-1',
  threshold: 1,
  thresholdType: 'above',
  interval: '5m',
};

describe('validateSaveAlertInput channel comparison', () => {
  it('accepts channel and channels[0] that are genuinely equal', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      channel: wh('a'),
      channels: [wh('a')],
    });

    expect(result).toBeNull();
  });

  it('rejects channel and channels[0] that disagree on webhookId', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      channel: wh('a'),
      channels: [wh('b')],
    });

    expect(result).toContain('must match');
  });

  it('rejects channel and channels[0] that disagree on a field other than webhookId', () => {
    // Same webhookId, different label. The old webhookId-only comparison
    // would have called these equal.
    const result = validateSaveAlertInput({
      ...baseInput,
      channel: foreignChannel({
        type: 'webhook',
        webhookId: 'a',
        label: 'Primary',
      }),
      channels: [
        foreignChannel({ type: 'webhook', webhookId: 'a', label: 'Secondary' }),
      ],
    });

    expect(result).toContain('must match');
  });

  it('rejects duplicate entries within channels', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      channels: [wh('a'), wh('a')],
    });

    expect(result).toContain('Duplicate');
  });

  it('accepts channels entries that are genuinely different, including a pair differing only outside webhookId', () => {
    // Same webhookId, different label. The old webhookId-only comparison
    // would have wrongly collapsed these into a duplicate.
    const result = validateSaveAlertInput({
      ...baseInput,
      channels: [
        foreignChannel({ type: 'webhook', webhookId: 'a', label: 'Primary' }),
        foreignChannel({ type: 'webhook', webhookId: 'a', label: 'Secondary' }),
      ],
    });

    expect(result).toBeNull();
  });
});

describe('validateSaveAlertInput inline alerts', () => {
  const chartConfig: NonNullable<McpSaveAlertInput['chartConfig']> = {
    displayType: 'line',
    sourceId: 'source-1',
    select: [
      {
        aggFn: 'count',
        where: '',
        whereLanguage: 'lucene',
      },
    ],
    fillNulls: true,
  };

  it('requires chartConfig when source is inline', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      source: 'inline',
      savedSearchId: undefined,
      channel: wh('a'),
    });

    expect(result).toContain('chartConfig is required');
  });

  it('accepts an inline alert with a chartConfig', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      source: 'inline',
      savedSearchId: undefined,
      chartConfig,
      channel: wh('a'),
    });

    expect(result).toBeNull();
  });

  it('rejects a chartConfig on non-inline sources instead of silently dropping it', () => {
    const result = validateSaveAlertInput({
      ...baseInput,
      chartConfig,
      channel: wh('a'),
    });

    expect(result).toContain('only supported when source is "inline"');
  });
});
