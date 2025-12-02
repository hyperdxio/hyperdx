-- Remove source_table column from slo_definitions table
ALTER TABLE default.slo_definitions 
DROP COLUMN IF EXISTS source_table;


