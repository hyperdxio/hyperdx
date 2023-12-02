ALTER TABLE default.metric_stream DROP COLUMN is_delta;

--migration:split

ALTER TABLE default.metric_stream DROP COLUMN is_monotonic;
