---
"@hyperdx/app": patch
---

fix: slider thumb and mark styling not applying theme tokens

- Move slider thumb styling from classNames to inline styles to fix CSS specificity issue where Mantine defaults override theme tokens
- Add !important to slider mark styles to ensure token-based colors apply
- Fix vertical centering of 6px slider mark dots within the 8px track
- Remove broken translateX/translateY nudge that misaligned marks
