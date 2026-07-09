---
"@hyperdx/common-utils": minor
"@hyperdx/api": minor
"@hyperdx/app": minor
---

Adding consecutive-window configuration to alerts, so that you can specify a condition like "only fire this alert after some condition is met for N consecutive windows." This helps prevent flaky alerts (and pages), and cut down on alert noise in many cases.

Also adds a `PENDING` alert state for alarms that _will_ fire if current trends continue.
