---
"@hyperdx/api": minor
---

Add unique MongoDB index on accessKey field in User model to eliminate full collection scans during API key authentication. This could cause startup failures if any existing users share duplicate accessKey values.
