---
'@hyperdx/api': patch
---

Forward parsed JSON and form request bodies through the ClickHouse proxy,
including charset parameters and repeated form fields. Keep request framing in
sync with serialized bytes and preserve unparsed multipart streams.
