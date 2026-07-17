---
'@hyperdx/app': patch
---

feat(dashboards): color-code the out-of-the-box Browser RUM dashboard by value.
The Core Web Vitals tiles (LCP, INP, CLS) now render green / amber / red using
Google's official good / needs-improvement / poor thresholds, the Median and p90
Page Load tiles use opinionated latency bands, and the error-count tiles
(Sessions w/ Errors, JS Errors, AJAX Errors) turn amber when any errors are
present. Implemented entirely via the existing number-tile `colorRules`
mechanism — no renderer changes.
