---
"@hyperdx/cli": patch
---

fix(cli): exit with non-zero code when `upload-sourcemaps` fails

The `upload-sourcemaps` command now exits with code 1 when uploads fail
(missing source maps, pre-signed URL request failure, authentication failure,
or any per-file upload failure after retries). Previously these failures were
logged to stderr but the process exited cleanly with code 0, causing CI
pipelines to treat failed uploads as successes.
