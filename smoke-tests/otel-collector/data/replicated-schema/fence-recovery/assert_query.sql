-- Fence recovery after an interrupted conversion: the empty fence is dropped,
-- the non-empty fences are preserved (attached table with its data, detached
-- table still detached) and warned about, never dropped, and the target
-- database stays Replicated.
SELECT name FROM system.databases WHERE name LIKE 'default_pre_replicated_%' ORDER BY name FORMAT CSV;
SELECT count() FROM default_pre_replicated_1000000001.stranded FORMAT CSV;
SELECT count() FROM system.detached_tables WHERE database = 'default_pre_replicated_1000000002' AND table = 'stranded_detached' FORMAT CSV;
SELECT engine FROM system.databases WHERE name = 'default' FORMAT CSV;
