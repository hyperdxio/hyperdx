---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

fix: reject alerts on dashboard tiles the alert checker never evaluates (PromQL
tiles, and builder tiles with unsupported display types), and drop them when a
dashboard is saved
