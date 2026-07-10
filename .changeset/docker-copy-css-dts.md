---
"@hyperdx/app": patch
---

Fix Docker build failure after the TypeScript 6 upgrade. The `css.d.ts` ambient declaration (which types side-effect stylesheet imports like `@mantine/core/styles.css`) was not copied into the builder stage, so the production image build failed type checking with TS2882. The Dockerfile now copies `css.d.ts` alongside `mdx.d.ts`.
