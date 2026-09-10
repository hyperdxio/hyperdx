---
'@hyperdx/app': patch
---

fix: use mapContains for LLM dashboard attribute-presence filters

The LLM dashboard tested attribute presence with `SpanAttributes['key'] != ''`,
which no skip index can serve — the trace schema's `mapKeys(SpanAttributes)`
index only answers `mapContains`, and `!= ''` normalizes to `notEmpty()`. Every
tile therefore scanned all granules. Map subscripts are also subcolumn
references, so on ClickHouse 26.3+ each one adds a per-part size lookup during
PREWHERE planning.

Presence checks now use `mapContains`, which the index serves and which costs no
per-part lookups. Value expressions are unchanged. JSON attribute columns keep
the previous form, since their paths are real subcolumns.

Detection is now presence-based rather than presence-and-non-empty: an attribute
explicitly set to an empty string counts as present. Time-to-first-token keeps
its `> 0` comparison so zero-valued rows stay out of the latency percentiles.
