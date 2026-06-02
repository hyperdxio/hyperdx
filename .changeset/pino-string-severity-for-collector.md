---
'@hyperdx/api': patch
---

fix(logger): emit a string `severity` field so logs are classified correctly

The application logger emitted pino's default numeric `level` (e.g. `30`). The
OTel collector that tails container stdout can only promote a log's severity
from a string field, so numeric levels were ignored and the collector fell back
to scanning the log body for a level keyword — mis-classifying any log
containing a word like "alert" (e.g. the alert-checking task's output) as
FATAL.

The logger now adds a string `severity` label while keeping the numeric `level`
(which the HyperDX OTLP transport still requires), so structured logs are
classified by their real level instead of the body-keyword fallback.
