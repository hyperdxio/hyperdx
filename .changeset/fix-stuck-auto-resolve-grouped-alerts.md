---
"@hyperdx/api": patch
---

Fix: Prevent grouped alerts from getting permanently stuck in the ALERT state by resetting history state to OK when thresholds are no longer exceeded. Additionally, continuously-breaching grouped alerts will now only notify once per state transition (OK -> ALERT), rather than re-notifying on every evaluation tick.
