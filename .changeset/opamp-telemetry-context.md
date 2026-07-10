---
"@hyperdx/api": patch
---

Improve API telemetry quality. The OpAMP message handler span is now a wide event
carrying agent correlation and self-description context (instance UID, sequence
number and gap, raw + decoded capability flags, new-vs-existing, service name and
version, OS type, host arch, health/last-error/uptime, remote config apply
status/error, last-applied and sent config hashes for drift detection, effective
config presence/size, teams count, request/response sizes). A new
`hyperdx.opamp.remote_config_applications` counter tracks whether pushed configs
actually applied on agents. The shared error middleware now recognizes body-parser
errors: client disconnects (`request.aborted` / `ECONNABORTED`) are classified as
operational, logged at debug instead of error, and kept out of error tracking, and
`hyperdx.api.errors` gains a bounded `error_type` dimension so aborts, oversized
bodies, and malformed payloads are distinguishable.
