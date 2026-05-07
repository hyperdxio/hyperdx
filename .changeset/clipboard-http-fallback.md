---
"@hyperdx/app": patch
---

Fix copy buttons silently failing when HyperDX is served over plain HTTP. Add a `document.execCommand('copy')` fallback for non-secure contexts and a clear toast when both paths fail.
