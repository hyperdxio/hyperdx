---
'@hyperdx/api': patch
---

fix: recover the session store when MongoDB comes up after the API. The store
now connects once MongoDB is reachable and retries a failed connect, instead of
returning 500 for every logged-in request until the API restarts
