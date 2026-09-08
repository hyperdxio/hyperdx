---
'@hyperdx/app': patch
---

Stop the Help menu sparkling on every deploy. The "you haven't read the latest release notes" indicator compared the browser's last acknowledgement against `NEXT_PUBLIC_APP_VERSION`, which any deployment that stamps a build id into it (a git short SHA, a CI build number) changes on every deploy — so the nudge fired for every user every time whether a new release had been published or not. It now keys on the newest release version in the changelog, inlined at build time, and nudges only when that release is strictly newer than the one the browser has acknowledged, so a rollback no longer re-nudges everyone either.
