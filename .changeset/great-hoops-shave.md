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

These filters now lead with `mapContains`, which the index serves and which
costs no per-part lookups. On a staging trace table the LLM span predicate went
from a 36s planning stall to 7ms, and a two-key filter dropped from 1,306
granules to 3.

Gates that pair with a value expression the dashboard groups by keep their
non-empty check as a second conjunct, so an attribute set to `''` still cannot
appear as a blank row. The presence term prunes granules; the value term
preserves the meaning. It costs no extra per-part lookups, since it reads the
same keys the group-by already reads.

The one behavior change is LLM span detection, which is now presence-based: a
span carrying `gen_ai.system` at all is treated as an LLM span whatever the
value. Nothing groups by that predicate.

JSON attribute columns are unchanged — their paths are real subcolumns, there is
no key index to prune with, and a presence term would only duplicate reads.
