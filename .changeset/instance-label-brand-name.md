---
'@hyperdx/app': patch
---

feat: add optional `NEXT_PUBLIC_INSTANCE_LABEL` suffix to the browser tab title

Operators running multiple HyperDX instances (e.g. one per region) can now set `NEXT_PUBLIC_INSTANCE_LABEL` to append a short label to the browser tab title, e.g. "HyperDX UK". Empty by default, no behavior change if unset.
