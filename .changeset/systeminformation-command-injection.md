---
'@hyperdx/api': patch
---

fix: update systeminformation to 5.33.19

The root `resolutions` pin let the lockfile keep systeminformation 5.30.7, which
has known command injection advisories, including two high-severity ones in
`networkInterfaces()` on Linux (GHSA-5xpp-75jx-m839, GHSA-hvx9-hwr7-wjj9). The
API installs it through `@opentelemetry/instrumentation-host-metrics`, which
asks for `^5.31.6`, but the old pin held it at 5.30.7. The pin now starts at
5.33.19, the newest 5.x release, which fixes all of them.
