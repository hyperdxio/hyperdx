-- +goose Up
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_metrics_ts
ENGINE = TimeSeries
SETTINGS allow_experimental_time_series_table = 1;
