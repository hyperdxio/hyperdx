---
'@hyperdx/api': patch
---

fix(mcp): remove max_result_rows from MCP safety settings

Remove the hardcoded max_result_rows=100000 setting from MCP query
execution. Some ClickHouse connections impose profile constraints that
cap max_result_rows below our default, causing SETTING_CONSTRAINT_VIOLATION
errors. The remaining safety settings (max_execution_time=30, readonly=2)
and trimToolResponse provide sufficient protection.

Add a SETTING_CONSTRAINT_VIOLATION error hint so constrained settings
surface actionable guidance instead of raw ClickHouse errors.
