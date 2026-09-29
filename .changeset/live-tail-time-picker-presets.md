---
'@hyperdx/app': patch
---

fix: expand live tail time picker presets to 6h and clarify switch label

Enable 3h and 6h presets in live tail mode (previously capped at 1h in the picker, though longer ranges already worked via URL). Ranges above 6h remain disabled because the refresh tick (10s default) re-queries the full window, and 12–24h scans would be excessive. Rename the toggle switch from "Relative Time" to "Live tail ranges" to clarify that it controls which preset intervals are available, not whether live tail is active. Add a "Not available for Live Tail" tooltip to disabled presets (12h+).
