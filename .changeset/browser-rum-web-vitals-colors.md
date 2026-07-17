---
'@hyperdx/app': patch
---

feat(dashboards): revamp the out-of-the-box Browser RUM dashboard. Reorganize it
into four focused sections — Core Web Vitals, Load Time, Traffic & Page Views,
and Errors — so each metric lives with its peers instead of a single catch-all
"Performance Overview". Tiles are now color-coded by value: the Core Web Vitals
tiles (LCP, INP, CLS) render green / amber / red using Google's official good /
needs-improvement / poor thresholds, the Median and p90 Page Load tiles use
opinionated latency bands, and the error-count tiles (Sessions w/ Errors, JS
Errors, AJAX Errors) turn amber when any errors are present. A Markdown legend
tile in the Core Web Vitals section documents the thresholds (with a link to
web.dev) so viewers understand the standard behind the colors. Implemented
entirely via the existing number-tile `colorRules` and Markdown-tile mechanisms
— no renderer changes.
