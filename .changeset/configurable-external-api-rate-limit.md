---
'@hyperdx/api': minor
---

Make the external API v2 rate limit (`/api/v2/*`) configurable via `EXTERNAL_API_RATE_LIMIT_MAX`. Defaults to 100 requests/minute, matching the previous hardcoded value.