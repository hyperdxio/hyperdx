---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: decode escaped characters in Lucene range bounds

A range bound with an escaped colon, such as
`Timestamp:[2024-01-01T10\:00\:00 TO *]`, sent the internal placeholder to
ClickHouse (`'2024-01-01T10HDX_COLON00HDX_COLON00'`) and the query failed. Range
bounds are now decoded the same way as other search terms.
