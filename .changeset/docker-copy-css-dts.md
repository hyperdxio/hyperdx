---
"@hyperdx/app": patch
---

Fix Docker production image build by copying `css.d.ts` into the builder stage so side-effect stylesheet imports type-check under TypeScript 6.
