---
'@hyperdx/common-utils': patch
---

Honor open (`*`), exclusive (`{}`) and non-numeric bounds in Lucene ranges

`Duration:[* TO 500]` compiled to `Duration BETWEEN '*' AND 500`, which
ClickHouse rejects with `TYPE_MISMATCH`. Exclusive and half-open ranges such as
`Duration:{100 TO 500}` were all serialized as an inclusive `BETWEEN`. Bounds
were parsed with `parseFloat`, so `Timestamp:[2024-01-01 TO 2024-06-01]` became
`BETWEEN 2024 AND 2024` and matched nothing. The plain-English explanation of a
search now marks excluded bounds too.
