ALTER TABLE default.metric_stream ADD COLUMN is_delta Boolean CODEC(Delta, ZSTD(1));

--migration:split

ALTER TABLE default.metric_stream ADD COLUMN is_monotonic Boolean CODEC(Delta, ZSTD(1));
