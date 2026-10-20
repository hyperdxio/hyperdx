---
'@hyperdx/app': patch
---

feat: open Team Settings in local mode, with query settings saved to
localStorage

Local mode (`yarn app:dev:local`, Vercel previews) now links to Team Settings
and shows the Data and Query Settings tabs. Query settings such as the search
row limit and query timeout are saved in the browser and apply to its queries.
