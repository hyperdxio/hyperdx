---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: only split a query at a standalone SETTINGS keyword

`extractSettingsClauseFromEnd` cut the query at the first "settings" anywhere in
it, including inside a string or an identifier. A multi-series metric chart with
a metric such as `app.settings.reloads` produced SQL with an unterminated
string, and a SQL filter on a column such as `AppSettings` was rewritten to
reference `App`. The keyword now has to stand alone outside quotes.
