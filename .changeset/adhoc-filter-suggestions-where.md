---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

feat: narrow ad hoc dashboard filter suggestions with a condition

An ad hoc filter on SQL sources can now carry a SQL or Lucene "Keys and values
filter", like a queried filter's dropdown values filter, that limits the rows
its keys and values are suggested from. It can reference the dashboard's other
variables. While it references a required filter with nothing selected, the ad
hoc filter can't add or edit conditions and names the filter it is waiting on.
Failed suggestions now show the database's error message.
