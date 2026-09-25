---
'@hyperdx/app': patch
---

feat: attach a columns and sort bar to the Explore results table

The Explore list view's table is framed with a bar along its top holding a
"Display" menu (lines per row, resetting column widths), the generated SQL and
CSV download actions, and the Columns and Sort controls. Columns now offers
map/JSON sub-keys alongside top-level columns. Columns and Sort no longer have
their own SQL tabs; a hand-written SELECT or ORDER BY goes in the query editor.

The query editor toggle is now an "Advanced" switch in the top row, beside the
save actions, and Advanced is a mode: turning it on opens the SQL generated from the current view, and turning
it off returns to the search UI (asking first if the SQL was edited). While it
is on, Columns and Sort are disabled, and the Events view shows the SQL's rows
in the same table, with the row side panel where the selected columns allow.
"Reset to generated" is gone; turning Advanced off and on regenerates.
