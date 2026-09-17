---
"@hyperdx/api": patch
---

feat: add a pluggable token encryption service for stored third-party tokens. Set `TOKEN_ENCRYPTION_KEY` to a 32-byte key (base64 or hex) to encrypt them with AES-256-GCM; without it they are stored unencrypted.
