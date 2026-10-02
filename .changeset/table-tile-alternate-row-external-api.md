---
"@hyperdx/api": patch
---

feat(api): expose table tile alternate row background in the external Dashboards API

Add the optional `alternateRowBackground` boolean to the external REST Dashboards API for both builder and raw SQL table charts, matching the display setting available in the app. When true, the table tile renders alternating row background colors (zebra striping) for easier scanning on wide tables; it defaults to false.
