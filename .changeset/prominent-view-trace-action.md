---
'@hyperdx/app': patch
---

Make the log side panel "View Trace" action more noticeable: it now uses an
outlined (secondary) button with the trace source icon, larger compact size, and
is right-aligned so it stands out from the dimmed metadata row instead of
blending in as subtle inline text. A one-time dismissible popover points users to
the button the first time they open a log that has a trace; once dismissed it
never shows again.
