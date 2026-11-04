---
'@hyperdx/app': patch
---

Fix repeated login redirects after a session expires by clearing cached
authentication state with a full navigation to the login page.
