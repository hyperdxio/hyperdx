---
'@hyperdx/app': patch
---

feat: support a series limit on PromQL line and stacked bar charts

The Display Settings drawer now offers Series Limit for PromQL time charts. It keeps the top N series by peak value in the browser; leave it empty for the default of 250, or set 0 for unlimited.
