---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

feat(mcp): add denoise option to clickstack_search tool

Add a `denoise` boolean parameter to the MCP `clickstack_search` tool that
automatically filters out high-frequency repetitive event patterns from
search results, mirroring the web app's "Denoise Results" feature.

When enabled, the tool samples 10k random events, mines patterns using
the Drain algorithm, identifies noisy patterns (>10% of sample), and
filters them out of result rows. Returns filtered rows plus metadata
listing removed patterns with estimated counts.

Extracts shared denoise constants (`DENOISE_SAMPLE_SIZE`,
`DENOISE_NOISE_THRESHOLD`) into `@hyperdx/common-utils` so the web app
and MCP server use the same values.
