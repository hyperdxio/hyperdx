---
'@hyperdx/app': patch
---

feat: choose how property keys are ordered in the row side panel

The JSON viewer sorts keys alphabetically, which is the right default for wide
ClickHouse `Map(...)` columns like `ProfileEvents` but hides the stored column
order. The properties view options menu now offers "Sort keys A–Z", "Sort keys
Z–A", and "Original order"; the choice persists with the viewer's other
options. Array elements keep their index order in every mode.
