---
'@hyperdx/otel-collector': patch
---

Accept `Bearer `-prefixed Authorization header values on the OTLP receiver in standalone mode (`OTLP_AUTH_TOKEN`). Previously only the bare-token form of the header was accepted, rejecting RFC 6750 clients that send `Authorization: Bearer <token>`. The `Bearer`, `bearer`, and `BEARER` prefixed forms are now accepted alongside the bare token.
