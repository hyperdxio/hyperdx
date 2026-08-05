---
"@hyperdx/api": minor
---

feat(mcp): add `clickstack_emerging_signals` MCP tool — a two-window Drain pattern novelty detector that set-differences mined log/event patterns between an earlier baseline window and a current window to surface what is newly emerging or has disappeared. Shares the Drain sample-and-mine pipeline with `clickstack_event_patterns` via an extracted `mineWindowPatterns` helper, and keys patterns across windows with a `normalizeTemplate` helper.
