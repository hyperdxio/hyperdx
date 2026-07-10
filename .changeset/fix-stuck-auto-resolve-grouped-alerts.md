---
"@hyperdx/api": patch
---

Fix: Prevent grouped alerts from getting permanently stuck in the ALERT state by resetting history state to OK when thresholds are no longer exceeded.
