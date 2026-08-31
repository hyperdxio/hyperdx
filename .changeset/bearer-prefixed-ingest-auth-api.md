---
'@hyperdx/api': patch
---

Accept `Bearer `-prefixed Authorization header values on the OTel ingest endpoint in OpAMP-managed mode. The collector's bearer-token authenticator matches the full header value exactly and was configured with only the bare API key, so RFC 6750 clients that send `Authorization: Bearer <token>` were rejected. The generated collector config now also accepts `Bearer`, `bearer`, and `BEARER` prefixed forms of each ingestion API key.
