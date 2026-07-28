---
"@hyperdx/app": minor
---

feat(i18n): internationalize the web app. All frontend-owned user-facing copy
now resolves through i18next translation catalogs, and Preferences gains a
Language selector for English and Korean. English remains the default for new
and existing users, the locale is never inferred from the browser or OS, and the
selection is stored only in the existing local preferences record. Korean
catalogs can be filled in one reviewed key at a time; any key without a Korean
entry renders the English source copy. Routes, API contracts, user content,
query syntax, and server error details are unchanged.
