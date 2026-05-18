---
"@hyperdx/common-utils": patch
---

fix: Event Patterns and other CTE-using queries now correctly detect Date-typed partition columns and wrap them in toDate(), fixing "No results found" against sources with a Date partition key (e.g. event_date / EventDate).
