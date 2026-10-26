---
'@hyperdx/app': patch
---

Fix missing SQL syntax highlighting in the Explore query editor. The app
declared `@codemirror/language` on a range no other CodeMirror package
resolved to, so two copies were installed and the highlighter never
recognised the tree the SQL parser produced. Align the range and the
highlighting comes back everywhere it was silently absent.

The full-statement query editor now also carries line numbers and the shared
code background, so it reads as a code block rather than a tall text field.
