---
'@hyperdx/app': patch
---

feat: show icon indicator on tiles where dashboard filters are excluded due to source scoping

Dashboard tiles now display a filter icon in the toolbar when active dashboard filter values are not being applied to the tile because those filters are scoped to other sources via "Applies to sources". Hovering the icon shows a tooltip explaining why the tile may not update when filter values change.
