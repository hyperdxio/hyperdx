---
"@hyperdx/app": patch
---

fix(TimePicker): keep relative/absolute toggle in sync with URL state

The time picker's relative-time toggle was only seeded from
`defaultRelativeTimeMode` at mount and never re-synced when the prop changed
(e.g. after switching live intervals via the URL). This left the picker
rendering in a mode that no longer matched the URL, causing nondeterministic
behavior. The toggle now follows `defaultRelativeTimeMode` whenever it changes.
