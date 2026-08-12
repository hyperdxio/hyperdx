---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

SQL search now works across multiple sources, and a source that can't answer
the search says so. Previously multi-source search refused SQL outright, and a
Lucene query naming a field a source doesn't have silently returned nothing
from that source — the field resolved to a condition matching no rows. Both
languages now resolve the columns a search references against each source's
schema up front: sources that have them run the query, and a source that
doesn't is excluded with the missing column named on its status chip.
