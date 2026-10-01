---
'@hyperdx/api': minor
---

The API no longer falls back to the public session secret `hyperdx is cool 👋`.
If `EXPRESS_SESSION_SECRET` is unset, the API generates a random secret and
reports it once at startup when authentication is enabled. Authenticated
deployments that explicitly set the old public value also get a random secret
and the same warning; the public value remains available only in the no-auth
local demo. Set it to a random string (`openssl rand -hex 32`) in any deployment
with authentication enabled — without it, restarting the API signs every user
out, and replicas do not share sessions.
