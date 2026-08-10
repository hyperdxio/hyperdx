---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': minor
---

feat: alerts now notify once on the OK -> ALERT transition instead of on every evaluation while firing. A sustained breach used to send a duplicate notification on every evaluation interval; a new `renotifyIntervalMinutes` setting ("Re-notify every" under Advanced Settings) controls repeats instead — leave it unset for transition-only (the new default), set `0` to restore the old notify-on-every-evaluation behavior, or set N to re-notify every N minutes. Resolve notifications are unchanged. This is a behavior change for existing alerts: set `renotifyIntervalMinutes: 0` to keep the old behavior.
