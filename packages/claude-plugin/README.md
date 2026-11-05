# @hyperdx/claude-plugin

A Claude Code plugin that draws ClickStack MCP query results as charts in the
terminal. When Claude runs `clickstack_timeseries` or `clickstack_table`, the
tool row shows a line, stacked bar, bar, pie, number or table chart in place of
the raw JSON. Claude still reads the full result.

Charts are drawn by the same renderers as the `hdx` CLI, so a query looks the
same in both.

## Install

At a Claude Code prompt:

```
/plugin install hyperdx-charts --marketplace hyperdxio/hyperdx
```

Answer `y` to add the marketplace and pick a scope. The plugin asks for your
HyperDX URL and your personal API access key (Team Settings > API keys), then
connects the ClickStack MCP server for you, so there is no separate
`claude mcp add` step. If you already added the server yourself, remove it with
`claude mcp remove clickstack` to avoid two copies of every tool. The bundled
server's tools are named `mcp__plugin_hyperdx-charts_clickstack__*`, so update
any permission rules that name `mcp__clickstack__*`. Charts stay off until both
values are set; `/plugin configure hyperdx-charts` sets them later.

## Limits

- Terminal only. Desktop and IDE surfaces keep the normal tool row.
- Results too large for Claude's context are replaced by a file pointer before
  the plugin sees them, so they are not charted. Ask for a coarser
  `granularity`.
- The Claude Code plugin API this uses is early access and may change between
  releases.

## Development

```bash
yarn build                  # bundle src/ into hooks/chart.js
yarn ci:unit                # jest, src/__tests__/*.spec.ts
claude plugin test .        # engine tests, test/*.test.tsx
claude plugin validate .
claude --plugin-dir .       # run Claude Code with the plugin loaded
```

`hooks/register.tsx` is compiled by Claude Code and must stay readable to
`claude plugin validate`, so only the renderer is bundled. The bundle must stay
under the 1 MiB hooks module limit; `tsup.config.ts` explains how.
