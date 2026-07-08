---
'@hyperdx/app': patch
---

Fix primary button hover text color by using Mantine's `--button-hover-color`
variable (the theme previously set the non-existent `--button-color-hover`, so
the hover text color was never applied and could fall through to an inherited
page color).
