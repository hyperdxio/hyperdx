---
'@hyperdx/common-utils': patch
---

Treat `_` and `%` in a search term as literal characters, not LIKE wildcards

Search terms were interpolated straight into the ILIKE pattern, so ClickHouse
read their `_` and `%` as wildcards. `ServiceName:user_service` also matched
`user-service` and `user.service`, and the negated `-ServiceName:user_service`
dropped those same rows. Token-index lookups still receive the raw term.
