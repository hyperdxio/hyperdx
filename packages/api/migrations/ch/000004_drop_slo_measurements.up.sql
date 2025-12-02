-- Drop redundant measurements table (we query aggregates directly now)
DROP TABLE IF EXISTS default.slo_measurements;

