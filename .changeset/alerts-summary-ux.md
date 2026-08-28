---
'@hyperdx/app': minor
---

feat(alerts): edit from the alerts list, filter by alert source, and label the source icons

The alerts page row menu now opens the alert editor directly, so changing a
threshold no longer means navigating to the alert first. The source icon on
each row gets a tooltip and accessible label naming what it watches ("Saved
search" / "Dashboard tile"), and a new filter narrows the list by that source
— free-text search matches it too, so typing "tile" works without touching the
dropdown. Team settings tabs gain icons.
