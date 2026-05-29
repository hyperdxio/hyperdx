---
'@hyperdx/api': patch
---

feat(mcp): add denoise option to hyperdx_search tool

Add a `denoise` boolean parameter to the MCP `hyperdx_search` tool that
automatically filters out high-frequency repetitive event patterns from
search results, mirroring the web app's "Denoise Results" feature.

When enabled, the tool samples 10k random events, mines patterns using
the Drain algorithm, identifies noisy patterns (>10% of sample), and
filters them out of result rows. Returns filtered rows plus metadata
listing removed patterns with estimated counts.
