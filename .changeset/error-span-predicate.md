---
'@hyperdx/app': patch
---

Count spans recorded with the legacy `STATUS_CODE_ERROR` status as errors on the Services and LLM dashboards. The errored-span definition now lives in one place and matches both that value and the short `Error` form, so those dashboards no longer undercount errors from collectors that emit the long form.
