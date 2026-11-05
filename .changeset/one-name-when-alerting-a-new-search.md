---
'@hyperdx/app': patch
---

fix: Creating an alert from the search page asks for one name, not two. An unsaved search is named once in the alert modal's header and the alert inherits that name and its tags; on a saved search the alert's own name field is labelled "Alert name" and shows the inherited name as its placeholder instead of pre-filling a duplicate.
