---
"@hyperdx/app": patch
"@hyperdx/common-utils": patch
---

feat(dashboard): table tile header separator and optional alternate row background

Add an always-on separator between a table tile's sticky header and its rows so the boundary stays clear as rows scroll underneath. Add a new **Alternate Row Background** display setting (off by default) that zebra-stripes builder table tiles for easier scanning on wide tables. Both work in light and dark color modes.
