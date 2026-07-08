---
'@hyperdx/api': patch
---

fix: honor INGESTION_API_KEY in the all-in-one auth image

The all-in-one entrypoint set `HYPERDX_IMAGE` to values (`all-in-one` /
`all-in-one-noauth`) that did not match the strings `config.ts` compares against
(`all-in-one-auth` / `all-in-one-noauth`). As a result `IS_ALL_IN_ONE_IMAGE` was
never true in the auth image, so the `INGESTION_API_KEY` env var was silently
ignored and the OpAMP-delivered collector config only accepted the team's
UI-generated key.

The entrypoint now reports `all-in-one-auth` for the auth variant and
`all-in-one-noauth` for the no-auth variant, so a pre-shared `INGESTION_API_KEY`
is added to the collector's accepted bearer tokens. This lets demo/bootstrap
stacks specify a known ingestion key up front instead of retrieving the
generated key from the UI — the all-in-one equivalent of the standalone
collector's `OTLP_AUTH_TOKEN`.
