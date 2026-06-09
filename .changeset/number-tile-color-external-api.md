---
"@hyperdx/api": minor
---

Support number-tile color authoring through the external dashboards API. The v2 REST API and OpenAPI spec now accept `color` (a palette token) and `colorRules` (ordered conditional color rules, last match wins) on builder number tiles, and `color` on raw SQL number tiles, matching what the in-product number-tile editor persists. Color rules accept the numeric and equality operators the editor offers (`gt`, `gte`, `lt`, `lte`, `between`, `eq`, `neq`). Existing dashboards keep working: tiles saved before the palette was renamed to hue names are normalized to the current token names on read.
