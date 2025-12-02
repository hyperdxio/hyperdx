-- Add source_table column to slo_definitions table
ALTER TABLE default.slo_definitions 
ADD COLUMN IF NOT EXISTS source_table String DEFAULT 'otel_logs';


