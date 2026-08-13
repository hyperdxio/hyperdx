---
'@hyperdx/api': patch
---

Treat a session whose user no longer exists as logged out instead of failing the
request. Deleting a team member left that person's browser holding a session
cookie pointing at a user document that was gone, and `deserializeUser` reported
the missing user as an error rather than as an unauthenticated session. Because
`passport.session()` runs ahead of every router, each request carrying the
cookie came back `500 Something went wrong :(` regardless of path or method,
including public routes such as `POST /team/setup/:token` and `GET /logout`, so
a removed person could neither accept a fresh invite nor clear their own
session. The stale id is now dropped from the session and the request continues
unauthenticated, so protected routes answer 401 and the browser is sent back to
the login page.
