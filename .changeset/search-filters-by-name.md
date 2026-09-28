---
'@hyperdx/app': patch
---

feat: search filters by name in the search page sidebar

Teams with a wide schema had no way to reach a filter that wasn't in the sidebar's default list, which shows low-cardinality columns and map sub-fields only. The new search box filters what is already rendered as you type, and runs a second query for matching fields the browse list never loaded, so a high-cardinality column is reachable by name.
