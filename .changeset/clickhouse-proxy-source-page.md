---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

Propagate the originating page to `clickhouse-proxy` as W3C baggage. Proxy requests carried no attribution — browsers send no Referer to them and the route lives in client-side state — so a tab saturating the shared proxy could not be traced back to the screen that opened it without walking up to the RUM parent span. The browser ClickHouse client now sets `hyperdx.source_page` in the `baggage` header, plus `hyperdx.source_mode` when the view refreshes on its own (live tail, kiosk dashboards), and the proxy promotes both onto the request span as `hyperdx.query.source_page` and `hyperdx.query.source_mode`. Only the pathname is sent, since the query string holds user search terms and baggage travels downstream; the proxy promotes an allowlist of keys so a client cannot write arbitrary span attributes, and leaves the header in place rather than stripping a standard propagation header.
