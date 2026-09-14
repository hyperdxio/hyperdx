---
'@hyperdx/app': patch
---

fix: prevent IME Enter from submitting inputs prematurely

During IME composition (Japanese, Korean, Chinese input), pressing Enter to
confirm a character conversion was also triggering form submissions and search
actions. All Enter-key-to-submit handlers now check `isComposing` and skip
submission while the IME is active.
