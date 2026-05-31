---
'@hyperdx/app': minor
---

feat: render active filters as inline chips in search where input

Active sidebar filters now appear as chips rendered inline inside the
search WHERE input itself, replacing the separate row of pills that
previously sat below the input. Chips render in both SQL and Lucene
modes, can be removed with the chip's × button, and Backspace at the
start of an empty input removes the last chip.
