---
name: Bug report
about: Something in HyperDX is broken or behaving unexpectedly
title: ''
labels: bug, Needs Feedback
---

**What happened?**

<!-- What you saw, and what you expected instead. -->

**Steps to reproduce**

<!--
Please check whether this reproduces on https://play.hyperdx.io (demo data) and
paste the URL if it does. If you're working from the repo, `yarn app:dev:local`
plus onboarding → "Connect to Demo Server" gives you the same data locally. If
it only happens with your own data, include the table schema
(`SHOW CREATE TABLE ...`) and source settings.
See https://github.com/hyperdxio/hyperdx/blob/main/CONTRIBUTING.md#reproducing-issues-and-prs
-->

**Reproduces on play.hyperdx.io?** <!-- yes (link) / no / didn't try -->

1.
2.
3.

**How are you running HyperDX?**

<!--
The all-in-one Docker image, Docker Compose, Helm, ClickHouse Cloud, or a local
dev stack — and which version or image tag. If you brought your own ClickHouse,
say which version.
-->

**Where does it show up?**

<!--
The UI (which page, and which browser), the API, the OpenTelemetry collector, or
the CLI. A screenshot or a short video helps a lot for UI bugs.
-->

**Debug info**

<!--
For UI bugs, please include this — it saves a lot of back-and-forth. Open the
Help menu (bottom-left of the app) and click "Copy debug info", then paste the
block below. It captures versions, deployment mode, browser, and session id; no
API keys or query params are included. Skip it if you're only hitting the
collector or CLI (write N/A).
-->

```
(paste Help → Copy debug info here)
```

**Logs**

<!--
Anything relevant from the browser console, the API container, or the collector.
Please redact API keys and connection strings.
-->
