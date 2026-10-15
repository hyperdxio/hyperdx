---
'@hyperdx/api': patch
---

Forward the bytes consumed by the ClickHouse proxy's body parsers without
changing JSON values, form fields or text encodings. Keep request framing in
sync with inflated bytes and preserve unparsed multipart streams.
