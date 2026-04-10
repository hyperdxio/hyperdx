---
"@hyperdx/cli": minor
---

**Breaking:** Replace `-s`/`--server` flag with `-a`/`--app-url` across all CLI commands (except `upload-sourcemaps`). Users should now provide the HyperDX app URL instead of the API URL — the CLI derives the API URL by appending `/api`.

- `hdx auth login` now prompts interactively for login method, app URL, and credentials (no flags required)
- Expired/missing sessions prompt for re-login with the last URL autofilled instead of printing an error
- Add URL input validation and post-login session verification
- Existing saved sessions are auto-migrated from `apiUrl` to `appUrl`
