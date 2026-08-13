---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/cli': patch
---

Clean up ESLint warnings and tighten lint enforcement. Resolved all
`no-unused-vars` and `@typescript-eslint/ban-ts-comment` warnings (removing dead
code and converting `@ts-ignore` to described `@ts-expect-error`), then promoted
those rules to `error` in the api/app/common-utils configs, disabled the noisy
`@typescript-eslint/no-empty-function` rule in app, and lowered each package's
`--max-warnings` ceiling so the counts can't regress. Behavior is unchanged.
