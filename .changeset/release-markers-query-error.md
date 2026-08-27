---
'@hyperdx/app': patch
---

Release markers now show a distinct "couldn't load release markers" notification when the underlying query fails (e.g. a source's version expression references a column, such as `ResourceAttributes`, that the table doesn't have), instead of silently rendering no markers indistinguishable from "no releases found in this time range."
