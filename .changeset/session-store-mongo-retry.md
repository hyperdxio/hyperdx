---
'@hyperdx/api': patch
---

fix: recover the session store when MongoDB comes up after the API. Sessions now
use the mongoose connection, so they share its startup retry instead of
returning 500 for every logged-in request until the API restarts
