---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
---

Dashboard table tiles configured with a row-click action now show a hover hint describing where the click will go (for example, `Search HyperDX Logs` or `Open dashboard "API Latency Drilldown"`). The cell wrapper is now a real link, so cmd-click and middle-click open the destination in a new tab, right-click shows the browser context menu with "Open in New Tab" and "Copy Link Address", and the destination URL appears in the browser status bar on hover. Keyboard users can Tab to a cell and press Enter to navigate, with a visible focus ring.
