---
'@hyperdx/app': patch
---

Copy `css.d.ts` into the Docker build stage so the app image compiles. The
TypeScript 6 upgrade added ambient `declare module '*.css'` declarations in
`css.d.ts` to satisfy TS2882 for side-effect stylesheet imports, but the
Dockerfiles only copied `mdx.d.ts`, so `next build` failed inside the
container.
