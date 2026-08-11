---
'@hyperdx/app': minor
---

The filters sidebar now works when searching multiple sources. Facet fields
and values merge across the selected sources, and checking a value filters
every source that has the field. A source whose table lacks a filtered column
is excluded from the results with a visible reason on its status chip instead
of silently returning unfiltered rows. Filter pills and add-to-filter from the
row side panel work in multi-source mode too.
