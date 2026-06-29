---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

refactor(metrics): unify AttributesHash to variadic cityHash64 across Map and
JSON metric schemas

Sum / Gauge / Histogram metric queries now compute AttributesHash as
`cityHash64(ScopeAttributes, ResourceAttributes, Attributes)` for both
Map(LowCardinality(String), String) and JSON attribute columns. Previously
the Map-schema path wrapped the three maps in `mapConcat()` before hashing,
and the JSON-schema path used the variadic form; the schema-detection
ClickHouse round-trip and the `attrHashExpr` helper / `isJsonSchema`
plumbing are gone.

Compatibility:
- Per-row AttributesHash values change for every Map-schema metric row,
  but the hash is recomputed inside CTEs on every query — no materialized
  view, projection, ALIAS column, or cache persists it, so no downstream
  consumer is affected (audit: OSS only).
- Cross-scope same-key behaviour shifts: two rows that carry the same
  logical key in different attribute scopes (e.g. `host` in
  `ResourceAttributes` for one emission and `host` in `Attributes` for the
  next) now hash distinctly and land in separate series. Previously the
  mapConcat path collapsed them into one series. This only matters when an
  OTel collector processor promotes attributes across scopes mid-stream;
  most SDKs emit attributes in stable scopes. The new behaviour is captured
  by an integration test in `packages/api/src/clickhouse/__tests__`.

HDX-4466.
