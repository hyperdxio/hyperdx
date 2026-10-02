---
'@hyperdx/app': patch
---

feat: add `@clickhouse/click-ui` as a dependency and mount `ClickUIProvider`
next to `MantineProvider`. The provider follows the HyperDX color mode and does
not persist its own theme. The "open an issue on GitHub" link in error messages
is the first component to use click-ui (`Link`).
