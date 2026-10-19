---
'@hyperdx/api': patch
---

fix(mcp): `clickstack_sql` now binds the bucket-size parameters its description
advertises. `{intervalSeconds:Int64}`, `{intervalMilliseconds:Int64}`,
`$__interval_s`, `$__timeInterval` and `$__timeInterval_ms` used to fail with
"Substitution intervalSeconds is not set", including the tool's own time-series
example.
