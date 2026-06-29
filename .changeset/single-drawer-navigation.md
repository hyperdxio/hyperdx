---
"@hyperdx/app": minor
---

Redesign the event side panel into a single right-hand drawer with breadcrumb-stack navigation. Logs, traces, and sessions now navigate in-place (surrounding-context drilldowns, log → trace via a new "View Trace" action, and session → event) instead of stacking layered drawers, with a unified `SidePanelBreadcrumbs` trail that is restorable from the URL. The header gains a metadata row (timestamp, service, duration, status, Copy Trace ID) and the session drawer's close button now closes the entire panel.
