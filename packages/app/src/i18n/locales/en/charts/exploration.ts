export const aggFn = {
  count: 'Count of Events',
  sum: 'Sum',
  p99: '99th Percentile',
  p95: '95th Percentile',
  p90: '90th Percentile',
  p50: 'Median',
  avg: 'Average',
  max: 'Maximum',
  min: 'Minimum',
  count_distinct: 'Count Distinct',
  any: 'Any',
  increase: 'Increase',
  none: 'Custom',
} as const;

export const granularity = {
  auto: 'Auto Granularity',
  thirtySecond: '30 Seconds Granularity',
  oneMinute: '1 Minute Granularity',
  fiveMinute: '5 Minutes Granularity',
  tenMinute: '10 Minutes Granularity',
  fifteenMinute: '15 Minutes Granularity',
  thirtyMinute: '30 Minutes Granularity',
  oneHour: '1 Hour Granularity',
  twelveHour: '12 Hours Granularity',
  oneDay: '1 Day Granularity',
  sevenDay: '7 Day Granularity',
} as const;

export const page = {
  noLogSource: 'No log source is associated with the selected metric source.',
  chartGenerated: 'Chart generated successfully',
  errorGenerating: 'Error Generating Chart',
  aiAssistantNotice:
    'New AI Assistant available, enable with configuring the <code>ANTHROPIC_API_KEY</code> environment variable on the {{brandName}} server.',
  aiAssistantWithShortcut: 'AI Assistant [A]',
  experimental: 'Experimental',
  promptPlaceholder: 'ex. Error counts by service over last 2 hours',
  generate: 'Generate',
  browserTitle: 'Chart Explorer - {{brandName}}',
} as const;
