---
'@hyperdx/api': patch
---

fix(api): tighten redactSecrets after deep-review on #2188

Several security/correctness gaps surfaced by deep-review across
two passes on the original redactSecrets PR.

- The `bearer` value alphabet is now `\S+`. Real-world payloads
  carry plenty of opaque non-JWT bearers with `:`, `%`, or quote
  chars in them, and any alphabet narrower than `\S+` leaks the
  suffix past `[REDACTED]`. RFC 6750's b64token alphabet is a
  strict subset of `\S+`. (Same fix subsumes the earlier change
  that added `_` to cover JWT signatures.)
- The `basic-auth-url` scheme allowlist now covers
  http(s) / ws(s) / ftp / sftp / ssh / postgres(ql) / mysql /
  mariadb / mongodb(+srv) / mssql / sqlserver / snowflake /
  redis(s) / amqp(s) / kafka(+ssl) / clickhouse / smtp(s) /
  ldap(s) / nats. The match is also case-insensitive (RFC 3986
  declares schemes case-insensitive), so `HTTPS://user:pw@host`
  no longer bypasses redaction.
- The `llm-vendor-key` pattern now catches OpenAI ("sk-..."),
  Anthropic ("sk-ant-..."), and Google Gemini ("AIza..." with 35
  trailing chars). Without Gemini coverage, a Gemini API key in
  an observability payload would be exfiltrated to the very
  provider that issued it.

Docstring scopes the redactor explicitly to LLM input. Tests
cover each new shape, the JWT-with-underscore regression, the
opaque-bearer-with-`:` / `%` regressions, the uppercase-scheme
bypass, and the Gemini key shape.
