---
'@hyperdx/common-utils': minor
---

Add `core/severity` with the OpenTelemetry log severity rules:
`getSeverityClass` (from SeverityNumber 1 and up, falling back to a
case-insensitive severity text prefix), `getSeverityShortName` and
`getSeverityLabel`.
