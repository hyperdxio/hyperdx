---
'@hyperdx/cli': patch
'@hyperdx/otel-collector': patch
---

`hdx support-bundle` collects API profiles, ClickHouse errors, failed queries
and table sizes into one redacted tarball for support. The collector now serves
pprof on `127.0.0.1:1777` inside its container, so its heap and CPU profiles
can be pulled with `docker exec` or `kubectl exec`.
