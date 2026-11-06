---
'@hyperdx/api': patch
'@hyperdx/otel-collector': patch
---

fix: let browsers cache the collector's CORS preflights for 10 minutes

The OTLP receiver now answers preflights with `Access-Control-Max-Age: 600`.
Without it, browsers cached a preflight for only 5 seconds, which is how often
the browser SDK exports, so about half of its requests were preflights.
