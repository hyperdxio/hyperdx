Copied from smoketown/generator, apart from dropped `.js` import suffixes and
`emit.ts`, which buffers rows instead of exporting OTLP.

To re-sync: copy the files over, drop the `.js` import suffixes, run
`prettier` and `eslint --fix`, and keep the type annotation in
`incidents/denylist-oom/incident.ts` (needed for this package's newer
TypeScript). ESLint's `no-restricted-imports` and `no-unused-vars` are off for
this directory in `eslint.config.mjs`.
