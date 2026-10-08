#!/usr/bin/env bats

# HDX-4633: CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT may be a URL. entrypoint.sh
# splits the scheme off for the prometheusremotewrite exporter
# (config.standalone.promql.yaml) and keeps host:port for everything else.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "PromQL: an http:// endpoint URL still remote-writes metrics into the TimeSeries table" {
    run docker compose logs otel-collector-promql-url
    [ "$status" -eq 0 ]
    [[ "$output" == *"CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT scheme: http"* ]]

    # ClickHouse's remote_write handler (docker/clickhouse/local/config.xml)
    # always writes to default.metrics_ts, but the collector only migrates that
    # table with ENABLE_PROMQL=true and into its own database. Creating it here
    # avoids racing the otel-collector service's migrations on `default`.
    run clickhouse-client --port=9000 --query="CREATE TABLE IF NOT EXISTS default.metrics_ts ENGINE = TimeSeries SETTINGS allow_experimental_time_series_table = 1"
    [ "$status" -eq 0 ]

    emit_otel_data "http://localhost:64318" "data/metrics/promql-remote-write" "metrics"
    wait_for_rows 9000 "SELECT count() FROM timeSeriesTags(default, metrics_ts) WHERE metric_name = 'smoke_promql_url_gauge' SETTINGS allow_experimental_time_series_table = 1" 1
}

@test "PromQL: collector fails fast with a clear error when the endpoint includes a path" {
    run docker compose logs otel-collector-promql-bad-endpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT must not include a path"* ]]

    run docker compose ps --status running --services
    [ "$status" -eq 0 ]
    [[ "$output" != *"otel-collector-promql-bad-endpoint"* ]]
}
