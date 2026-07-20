---
"@hyperdx/api": patch
---

fix: Improve and standardize webhook URL validation

### `WEBHOOK_HOSTNAME_ALLOWLIST`

Use this optional setting to permit webhook delivery to a hostname or private/reserved IP address that the SSRF validator would otherwise block. Values are comma-separated. A hostname entry also permits its subdomains, while an IPv4 or IPv6 entry matches only that exact address. The allowlist does not bypass protocol validation, Slack hostname validation, or the exact host-and-port block for configured ClickHouse and MongoDB services.

For example, this permits `localhost`, any `*.hooks.localhost` hostname, the exact IPv4 address `10.0.0.1`, and the exact IPv6 address `fd00::1`:

```env
WEBHOOK_HOSTNAME_ALLOWLIST=localhost,hooks.localhost,10.0.0.1,fd00::1
```
