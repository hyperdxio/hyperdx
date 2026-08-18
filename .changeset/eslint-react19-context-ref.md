---
'@hyperdx/app': patch
---

Adopt React 19 context and ref APIs across the app and enforce them via ESLint.
Render `<Context>` directly instead of `<Context.Provider>`, use the `use` hook
instead of `useContext`, and pass `ref` as a regular prop instead of wrapping
components in `forwardRef`. The corresponding `@eslint-react/no-context-provider`,
`no-use-context`, and `no-forward-ref` rules are promoted to `error` and the
app's `--max-warnings` ceiling is lowered. Behavior is unchanged.
