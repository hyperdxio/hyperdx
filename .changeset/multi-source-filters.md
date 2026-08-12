---
'@hyperdx/app': minor
---

The filters sidebar works across every selected source. Facet fields and
values merge across sources, value counts are summed, "load more" fans out,
and pins (personal and team-shared) read as a union and apply to the whole
selection. Checking a value filters every source that has the field; a source
whose table lacks a filtered column is excluded from the results with a
visible reason on its status chip instead of silently returning unfiltered
rows. Filter pills and add-to-filter from the row side panel work across
sources too.
