---
'@hyperdx/app': patch
---

feat(dashboard): add Table of Contents right rail with bulk collapse/expand

Adds a toggleable right-rail Table of Contents to the dashboard page, plus
"Collapse all sections" and "Expand all sections" actions. All three live
under a new "View" section in the dashboard's existing menu. TOC visibility
is persisted per-user via localStorage; bulk collapse uses the same
per-viewer URL state as single-section toggling, so it's shareable via link
and does not change the dashboard's stored defaults. Clicking a TOC entry
scrolls the section into view, auto-expanding it first if collapsed.
