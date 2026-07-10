---
"@hyperdx/api": patch
---

Add `HYPERDX_MCP_ALLOWED_HOSTS` to allow the MCP HTTP endpoint to accept additional `Host` header values beyond the SDK's localhost defaults. The MCP transport enables DNS-rebinding protection by default and rejects any non-localhost `Host` with "Invalid Host", which prevents reaching the MCP over a service DNS name (e.g. when a separate container connects to `http://hyperdx:8000/mcp` over a Docker network). Set this env var (comma/space separated) to the hostname(s) that should be accepted; the localhost defaults remain allowed. Unset by default, so behavior is unchanged.
