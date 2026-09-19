---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

Add a trace-level scope for search so multi-predicate `AND` can match across the
spans of a trace, not only within a single span.

Search gains a **Span | Trace** scope control. **Span** (the default) is
unchanged: every predicate must hold in the same span. **Trace** matches traces
where the predicates are satisfied by different spans of the same trace. Under
the hood each predicate is rewritten into its own
`TraceId IN (SELECT TraceId FROM <source> WHERE <predicate> AND <time>)` and the
parts are `AND`-composed, with the time filter pushed into every subquery.

Trace scope is fail-closed: it is offered only for trace sources that expose a
trace-id expression, and it resets to Span when the source is switched, so
existing searches and saved queries are unaffected.
