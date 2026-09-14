---
'@hyperdx/app': patch
---

fix: prevent IME Enter from submitting inputs prematurely

During IME composition (Japanese, Korean, Chinese input), pressing Enter to
confirm a character conversion was also triggering form submissions and search
actions. Enter-key handlers now ignore keystrokes that belong to an in-flight
IME conversion, checking both `isComposing` and the keyCode 229 that Safari
reports when it dispatches the confirming Enter after `compositionend`.
