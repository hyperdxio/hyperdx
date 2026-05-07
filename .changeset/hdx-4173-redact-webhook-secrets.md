---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix(security): redact sensitive fields from internal webhook API responses

The `GET /api/webhooks` endpoint now masks webhook URLs and redacts header and
query parameter values, preventing team members from retrieving secrets
configured by others. The `PUT` handler merges redacted markers back to stored
values so editing a webhook without re-entering secrets preserves the originals.
