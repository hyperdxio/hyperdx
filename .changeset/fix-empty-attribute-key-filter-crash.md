---
"@hyperdx/app": patch
---

Fix "Accordion.Item component was rendered with invalid value or without
value" error when expanding a map attribute group (e.g. LogAttributes) in the
search filters sidebar. Telemetry containing an empty attribute key produced a
filter group with an empty name, which Mantine rejects; such groups now render
with an `(empty)` placeholder name instead of crashing the panel.
