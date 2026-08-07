---
'@hyperdx/app': minor
---

feat: Query Stats drawer for inspecting ClickHouse query activity

- New "Query Stats" debug drawer available from the user menu, capturing every ClickHouse query the app dispatches
- Per-row status, duration (color-coded at 2s / 10s thresholds), and SQL preview with params interpolated client-side for readability
- Expandable row reveals interpolated SQL, raw parameterized SQL as sent to ClickHouse, params, query_id, connection, and a one-click "Run EXPLAIN"
- Filter by current page (reactive on client-side nav) and toggle visibility of EXPLAIN events
- Drawer state is transient (closed on every page load); opens via the user menu
- Capture is wrapped in defensive error handling and an error boundary so instrumentation can never break a production query
