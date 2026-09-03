---
'@hyperdx/app': patch
---

Add a `window.hdx` browser-console debug handle and a "Copy debug info" action in the Help menu, so you can confirm which build is deployed and grab the context worth attaching when filing an issue. `window.hdx.report()` (and the Help menu action) produces a pasteable summary: frontend version (from package.json), backend/API version (from `/api/health` — the two deploy separately), deployment mode, user/team ids, enabled env-configurable feature flags, current URL, screen/viewport/OS/browser info, and the RUM session id. The handle is installed once and reads its async fields (server version, identity, features, session id) live via getters.
