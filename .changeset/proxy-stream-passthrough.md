---
'@hyperdx/api': patch
---

fix: flush ClickHouse proxy responses per chunk instead of buffering them

The proxy now forwards each upstream chunk as it arrives, so streamed formats
reach the browser incrementally, and it no longer attempts to write a 500 after
the response has started (which threw `ERR_HTTP_HEADERS_SENT` from the proxy's
error listener).
