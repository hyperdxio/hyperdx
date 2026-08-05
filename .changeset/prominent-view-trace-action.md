---
'@hyperdx/app': patch
---

Make the log side panel "View Trace" action more noticeable: it now uses an
outlined (secondary) button with the trace source icon, larger compact size, and
is right-aligned so it stands out from the dimmed metadata row instead of
blending in as subtle inline text. The first time a log with a correlated trace
is opened, a one-time popover points users to the button; it is dismissed by an
explicit acknowledgement ("Got it" or clicking View Trace) and then never shows
again (persisted per browser). It deliberately does not intercept Escape, which
keeps its normal side-panel behavior.
