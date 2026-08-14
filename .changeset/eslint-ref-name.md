---
'@hyperdx/app': patch
---

Name `useRef` values consistently with a `Ref` suffix and enforce it via ESLint.
Renames the 10 flagged refs (in `DOMPlayer`, `EditTimeChartForm`, `useMetadata`,
`sessions`, and `utils`) to end in `Ref`, promotes
`@eslint-react/naming-convention/ref-name` to `error`, and lowers the app's
`--max-warnings` ceiling. Behavior is unchanged.
