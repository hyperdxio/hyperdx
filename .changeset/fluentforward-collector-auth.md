---
'@hyperdx/api': patch
---

fix: Stop the collector accepting unauthenticated Fluent Forward logs when
collector authentication is enforced. The `fluentforward` receiver (port 24225)
has no way to check an API key, so it is now left out of the OpAMP config for
teams that enforce collector authentication, which is the default for teams
created at registration.
