---
'@hyperdx/app': patch
---

fix(app): copy correct session URL on first Share Session click

The Share Session button captured `window.location.href` at render time, which ran before `nuqs` flushed `sid`/`sfrom`/`sto` into the URL. The button now reads the URL at click time via the shared `copyTextToClipboard` util, so the first copy always contains the session params (no reload needed).
