---
'@hyperdx/api': patch
---

fix: MCP tool responses that are over the size budget now shorten long strings with a `…(+N chars)` suffix instead of replacing them, say what was trimmed in `trimNotes`, and `clickstack_event_patterns` / `clickstack_emerging_signals` drop samples and shorten long patterns before cutting whole patterns, so the requested `topN` survives when it can
