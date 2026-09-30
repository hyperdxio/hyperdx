---
'@hyperdx/app': patch
---

feat: add optional `NEXT_PUBLIC_INSTANCE_LABEL` suffix to the tab title and sidebar

Operators running multiple HyperDX instances (e.g. one per region) can now set `NEXT_PUBLIC_INSTANCE_LABEL` to append a short label (max 7 chars) to the browser tab title and sidebar wordmark, e.g. "HyperDX UK". Empty by default, no behavior change if unset.
