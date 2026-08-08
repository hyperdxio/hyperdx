---
'@hyperdx/otel-collector': minor
---

Add OIDC-based bearer token authentication for the OTLP receiver in standalone mode, as an alternative to the existing static `OTLP_AUTH_TOKEN`. Set `OIDC_ISSUER_URL` and `OIDC_AUDIENCE` to validate incoming OTLP requests against an OIDC provider's published JWKS instead of a single long-lived shared secret.
