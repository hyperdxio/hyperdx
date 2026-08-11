---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Search across multiple sources at once. The search page's source selector can
now expand into a multi-select (up to 3 log/trace sources): results interleave
into one timestamp-ordered timeline with a per-row source badge, normalized
columns (Timestamp, Source, Service, Level, Message, and Duration when traces
are included), a histogram stacked by source, and an add-column picker over the
union of the selected sources' columns. Each source runs its own query
pipeline — sources on different connections work, and a failing source shows a
status chip instead of failing the whole search. Multi-source mode is
Lucene-only and shareable via URL; saved searches and alerts remain
single-source for now.
