---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

Fix MCP tool schemas being rejected by strict JSON Schema draft 2020-12 clients. The number-tile `colorRules` `between` rule declared its `value` as a Zod tuple, which `zod-to-json-schema` renders in the draft-07 tuple form (`items: [ ... ]`). Draft 2020-12 requires `items` to be a schema rather than an array, so `clickstack_save_dashboard` and `clickstack_patch_dashboard` failed validation — and clients that forward MCP tool schemas straight to an LLM provider (e.g. the Anthropic API) rejected the entire tool list with `tools.N.custom.input_schema: JSON schema is invalid`, making the MCP server unusable. `value` is now a fixed-length array, which validates identically and serializes to the same `[min, max]` wire format. A new test validates every MCP tool's input schema against the 2020-12 metaschema so this cannot regress.
