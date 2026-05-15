---
"@hyperdx/app": patch
---

Fix label color for red `Menu.Item` rows (for example Logout) by overriding `--menu-item-color` in global CSS. `Menu.extend` item styles do not apply when the menu dropdown is portaled outside the Menu root.
