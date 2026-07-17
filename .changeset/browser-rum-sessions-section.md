---
'@hyperdx/app': patch
---

feat(dashboards): add a "Sessions & Replay" section to the out-of-the-box
Browser RUM dashboard. A new **Recent Sessions** table lists client-side
sessions (page views, errors, distinct traces, user, service, last-active time)
ordered by recency; clicking a row drills into the Traces search view filtered
to that session, surfacing its client-side spans (the client-side trace). A
companion Markdown tile links out to Session Replay (`/sessions`) for full DOM
playback. Implemented entirely via existing table `onClick` drill-through and
Markdown-tile mechanisms — no renderer changes.
