---
"@hyperdx/common-utils": minor
"@hyperdx/app": patch
---

feat: default the direct_read map column optimization on supported ClickHouse versions

The full-text-search logs schema (`00002_otel_logs.sql`) now ships with
`ResourceAttributeItems`, `ScopeAttributeItems`, and `LogAttributeItems`
ALIAS columns plus their `text(tokenizer='array')` skip indexes. The
traces schema (`00005_otel_traces.sql`) similarly gains
`ResourceAttributeItems` and `SpanAttributeItems` ALIAS columns with
matching items indexes. New installs and freshly migrated tables get
the optimization automatically — no manual `ALTER TABLE` required.

Note: the traces table previously used only `bloom_filter` skip indexes
and worked on any ClickHouse version. The added `text(tokenizer='array')`
items indexes raise the minimum ClickHouse version required to **create**
the traces table to **>= 26.2**. Existing tables on older clusters are
unaffected (`CREATE TABLE IF NOT EXISTS` is a no-op).

At query time, the app gates the `Map['key'] = 'value'` →
`has(<MapItems>, concat('key', '=', 'value'))` rewrite on the connected
ClickHouse server version (`SELECT version()`, cached per connection).
The direct_read feature was backported into multiple stable 26.x release
lines, so the gate uses a per-branch minimum:

- 26.2 line: >= 26.2.19.43
- 26.3 line: >= 26.3.12.3
- 26.4 line: >= 26.4.3.37
- 26.5+ : always supported

Servers below their branch's threshold continue to compile filters into
the original Map-subscript form, since they cannot perform the direct_read
against the Map's underlying tuple storage that makes the optimization
profitable.
