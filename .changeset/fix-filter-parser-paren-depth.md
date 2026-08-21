---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

Fix dashboard filter selection state breaking on complex expressions. The
filter parser (shared with the search page) now tracks parenthesis depth in
addition to quote depth, so selections stored for expression-based filters such
as `if(SeverityText = 'error' OR SeverityText = 'fatal', 'Errors', 'Non-errors')`
or `if(SeverityText IN ('error', 'fatal'), 'Errors', 'Non-errors')` are parsed
correctly instead of being dropped or split on operators/keywords nested inside
the expression.
