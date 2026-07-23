---
'@hyperdx/app': patch
---

Detail drawers now close when you click outside of them. On Search and Sessions,
clicking outside the results table / session list dismisses the open drawer;
clicks inside the drawer, its nested popups/modals, or the results table keep it
open. This is on by default for row-table side panels (opt out with
`closeOnClickOutside={false}`).
