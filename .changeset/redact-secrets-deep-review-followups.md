---
'@hyperdx/api': patch
---

fix(api): tighten redactSecrets after deep-review on #2188

Three security/correctness gaps surfaced by the deep-review on the
original redactSecrets PR.

- The `bearer` value class now includes `_`, so a JWT bearer token
  with underscores in the signature ("eyJ...AbC_DeF") no longer
  terminates at the first underscore and leaks the trailing bytes
  past the [REDACTED] marker.
- The `basic-auth-url` scheme allowlist now covers
  postgres / postgresql / mysql / mariadb / mongodb(+srv) / redis(s)
  / amqp(s) / kafka / clickhouse, so embedded credentials in
  database connection strings are redacted alongside http(s) / ftp / ssh.
- New `llm-vendor-key` pattern catches OpenAI ("sk-...") and
  Anthropic ("sk-ant-...") API keys, so a vendor key cannot leak to
  the very provider that issued it.

Docstring now scopes the redactor explicitly to LLM input. Tests
cover each new shape and the JWT-with-underscore regression.
