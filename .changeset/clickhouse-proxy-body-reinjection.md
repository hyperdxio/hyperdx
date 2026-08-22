---
'@hyperdx/api': patch
---

Fix `/clickhouse-proxy` request-body re-injection, which dropped every body
whose content type was not the exact string `application/json`. The handler
compared `req.headers['content-type']` for equality, so
`application/json; charset=utf-8` and `application/x-www-form-urlencoded` fell
through with `req.body` still an object: `express.json()`/`express.urlencoded()`
had already drained the stream, `proxyReq.write(object)` threw, the throw was
swallowed by a bare `catch`, and nothing was ever written — leaving the upstream
blocked on a `Content-Length` worth of bytes that never arrived, so the request
hung until the client gave up. Serialization now keys off the media type with
parameters stripped, urlencoded bodies are re-encoded through `URLSearchParams`
(repeated keys stay repeated instead of collapsing to `a=1%2C2`), and
`Content-Length` is resynced to the re-serialized payload so normalization can
no longer truncate or over-read it. Requests that no parser consumed —
`multipart/form-data`, which `@clickhouse/client-web` emits once query params
exceed its URL budget — are now explicitly skipped rather than throwing on
`proxyReq.write({})`: body-parser sets `req.body = {}` before its content-type
check, so that write always threw and forwarding only worked because httpxy went
on to pipe the untouched stream. A write that does fail now destroys the proxied
request, surfacing as the proxy's own 500 instead of a body-less request and an
opaque ClickHouse 400.
