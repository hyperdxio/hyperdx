---
'@hyperdx/cli': patch
---

feat: support multiple teams and kubectx-style team switching in the CLI

Adds three new commands for users that belong to multiple teams (HyperDX Cloud /
EE):

- `hdx team list` — list every team the authenticated user belongs to, marking
  the active one
- `hdx team current` — print the currently active team
- `hdx team use <name-or-id>` — switch the active team (matched by team ID or
  case-insensitive name)

The active team is persisted to `~/.config/hyperdx/cli/session.json` so the
choice survives across CLI invocations, and the CLI now sends an `x-hdx-team`
header on every API and ClickHouse-proxy request so the server scopes data to
the chosen team. `hdx auth status` also surfaces the active team.

On single-team OSS deployments these commands are effectively no-ops.
