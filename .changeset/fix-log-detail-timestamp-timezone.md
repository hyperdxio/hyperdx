---
"@hyperdx/app": patch
---

fix(app): format log detail Timestamp in local timezone

The log detail JSON viewer rendered Timestamp and TimestampTime as raw UTC ISO strings while the results table used the shared FormatTime helper.
