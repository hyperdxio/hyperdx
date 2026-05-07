---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

fix(security): redact sensitive fields from internal webhook API responses

The `GET /api/webhooks` endpoint now masks webhook URLs (`<origin>/****`) and
redacts header and query parameter values (keys preserved, values replaced with
`****`), preventing team members from retrieving secrets configured by others.

The `PUT` handler merges redacted markers back to stored values so editing a
webhook without re-entering secrets preserves the originals.  Changing the URL
while preserving masked secrets is rejected to prevent exfiltration.

**Breaking:** Consumers of `GET /api/webhooks` will now see masked values for
`url`, `headers`, and `queryParams` instead of plaintext secrets.
