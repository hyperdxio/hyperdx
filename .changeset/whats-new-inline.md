---
'@hyperdx/app': minor
---

feat: show the latest release's features inline in the Help menu's "What's new"
section, with a link out to the full changelog. Replaces the full-changelog
modal; the recent feature headlines are generated from CHANGELOG.md at build
time so the app no longer ships the entire changelog as a fetched asset.
