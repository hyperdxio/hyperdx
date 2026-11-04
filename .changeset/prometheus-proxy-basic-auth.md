---
'@hyperdx/api': patch
---

fix: Authenticate to Prometheus connections whose host includes credentials

A Prometheus connection host such as `http://user:pass@prometheus:9090` made every PromQL query fail with "Failed to reach Prometheus", because `fetch` rejects URLs that carry credentials. The credentials are now sent as a Basic auth header.
