import { format } from '../sqlFormatter';

describe('sqlFormatter(clickhouse)', () => {
  test('should work with normal query', () => {
    const input =
      "SELECT countIf((ServiceName = 'hdx-oss-dev-api')),toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` FROM default.otel_logs WHERE (TimestampTime >= fromUnixTimestamp64Milli(1741887731578) AND TimestampTime <= fromUnixTimestamp64Milli(1742492531585)) AND ((ServiceName = 'hdx-oss-dev-api')) GROUP BY toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket`";
    const expected = `SELECT
  countIf ((ServiceName = 'hdx-oss-dev-api')),
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
FROM
  default.otel_logs
WHERE
  (
    TimestampTime >= fromUnixTimestamp64Milli (1741887731578)
    AND TimestampTime <= fromUnixTimestamp64Milli (1742492531585)
  )
  AND ((ServiceName = 'hdx-oss-dev-api'))
GROUP BY
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
ORDER BY
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\``;
    expect(format(input)).toBe(expected);
  });

  test('should work with brackets query', () => {
    const input =
      "SELECT countIf(ResourceAttributes['telemetry.sdk.language'] = 'nodejs'),ResourceAttributes['telemetry.sdk.language'],toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` FROM default.otel_logs WHERE (TimestampTime >= fromUnixTimestamp64Milli(1741887731578) AND TimestampTime <= fromUnixTimestamp64Milli(1742492531585)) AND (ResourceAttributes['telemetry.sdk.language'] = 'nodejs') GROUP BY ResourceAttributes['telemetry.sdk.language'],toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket`";
    const expected = `SELECT
  countIf (
    ResourceAttributes['telemetry.sdk.language'] = 'nodejs'
  ),
  ResourceAttributes['telemetry.sdk.language'],
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
FROM
  default.otel_logs
WHERE
  (
    TimestampTime >= fromUnixTimestamp64Milli (1741887731578)
    AND TimestampTime <= fromUnixTimestamp64Milli (1742492531585)
  )
  AND (
    ResourceAttributes['telemetry.sdk.language'] = 'nodejs'
  )
GROUP BY
  ResourceAttributes['telemetry.sdk.language'],
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
ORDER BY
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\``;
    expect(format(input)).toBe(expected);
  });

  test('should work with lucene brackets query', () => {
    const input =
      "SELECT countIf((`ResourceAttributes`['telemetry.sdk.language'] = 'nodejs')),ResourceAttributes['telemetry.sdk.language'],toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` FROM default.otel_logs WHERE (TimestampTime >= fromUnixTimestamp64Milli(1741887731578) AND TimestampTime <= fromUnixTimestamp64Milli(1742492531585)) AND ((`ResourceAttributes`['telemetry.sdk.language'] = 'nodejs')) GROUP BY ResourceAttributes['telemetry.sdk.language'],toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimestampTime), INTERVAL 6 hour) AS `__hdx_time_bucket`";
    const expected = `SELECT
  countIf (
    (
      \`ResourceAttributes\` ['telemetry.sdk.language'] = 'nodejs'
    )
  ),
  ResourceAttributes['telemetry.sdk.language'],
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
FROM
  default.otel_logs
WHERE
  (
    TimestampTime >= fromUnixTimestamp64Milli (1741887731578)
    AND TimestampTime <= fromUnixTimestamp64Milli (1742492531585)
  )
  AND (
    (
      \`ResourceAttributes\` ['telemetry.sdk.language'] = 'nodejs'
    )
  )
GROUP BY
  ResourceAttributes['telemetry.sdk.language'],
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\`
ORDER BY
  toStartOfInterval (toDateTime (TimestampTime), INTERVAL 6 hour) AS \`__hdx_time_bucket\``;
    expect(format(input)).toBe(expected);
  });
});
