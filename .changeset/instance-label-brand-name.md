---
'@hyperdx/app': patch
---

feat: add optional `NEXT_PUBLIC_INSTANCE_LABEL` suffix to the tab title and sidebar

Operators running multiple HyperDX instances (e.g. one per region) can now set `NEXT_PUBLIC_INSTANCE_LABEL` to append a short label to the browser tab title and sidebar, e.g. "HyperDX UK". Empty by default, no behavior change if unset. The sidebar label only shows when the sidebar is expanded, and replaces the UTC badge there when both are set.
