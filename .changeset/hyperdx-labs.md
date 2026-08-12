---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Add HyperDX Labs, a per-user opt-in for features that are still being built.
Open it from the user menu in the nav to see what's available and switch
individual experiments on or off. Everything is off by default, and your choices
are saved to your account rather than the browser, so they follow you across
devices (in local mode, where there is no account, they are kept in the browser).
Adds `PATCH /me/labs` and surfaces the opt-ins on `GET /me`. No experiments ship
in this release — this is the mechanism they'll use.
