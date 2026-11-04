---
'@hyperdx/api': patch
---

feat(mcp): `clickstack_sql` accepts a `queries` array to run up to 10
independent queries in parallel under a shared 60s deadline. Each query reports
its own `ok`/`error`/`timeout` status, so one failing query does not fail the
others. Single-query calls with `sql` behave as before.
