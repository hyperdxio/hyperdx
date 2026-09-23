---
'@hyperdx/api': patch
---

Session cookies are no longer signed with the public default
`hyperdx is cool 👋`. If `EXPRESS_SESSION_SECRET` is unset, the API generates a
random secret at startup and logs a warning. Set it to a random string
(`openssl rand -hex 32`) in any deployment with authentication enabled — without
it, restarting the API signs every user out, and replicas do not share sessions.
