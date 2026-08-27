---
'@hyperdx/app': minor
---

feat: rebuild the Help menu's "What's new" around the release notes. Replaces
the full-changelog modal with an inline section, a "View all releases" drawer,
and a sparkle on the Help icon when the running version hasn't been acknowledged
in this browser.

Everything shown now comes from the root CHANGELOG.md, the release-level summary
written during each release: its headline and opening paragraph lead the
release, breaking changes and new features are listed individually and badged
apart, and the remaining sections are summed up as counts linking to that
release's section of the changelog. Nothing is hand-authored in the app. The
whole changelog is no longer shipped as a fetched asset either — next.config.mjs
parses it at build time and emits a small public/whats-new.json instead.
