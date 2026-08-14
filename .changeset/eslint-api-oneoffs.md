---
'@hyperdx/api': patch
---

Clear the remaining small api ESLint warnings and enforce their rules. Merges
the duplicate Express `declare global` namespace blocks in the auth middleware
(the `namespace` + empty-interface augmentation pattern is required, so it
carries a scoped disable with a comment), and scopes `n/no-process-exit` off for
the process entry points (`src/index.ts`, `src/tasks/index.ts`) where exiting
with a status code is intended. `@typescript-eslint/no-namespace`,
`no-empty-object-type`, and `n/no-process-exit` are promoted to `error` and the
api `--max-warnings` ceiling is lowered. Behavior is unchanged.
