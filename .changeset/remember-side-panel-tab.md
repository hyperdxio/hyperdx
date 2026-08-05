---
'@hyperdx/app': patch
---

Remember the row side panel's last-used tab instead of resetting to Overview on
every open, so working through a list of rows in Column Values no longer means
re-clicking that tab on each one. Picking a neighbouring row out of Surrounding
Context also keeps you in your chosen view rather than dropping you back on
Overview. Navigations that target a specific tab (such as View Trace) still win,
and a remembered tab the row doesn't offer falls back to that row's default.
