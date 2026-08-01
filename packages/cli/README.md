# @hyperdx/cli

Command line interface for HyperDX.

## Uploading Source Maps

Upload JavaScript source maps to HyperDX for stack trace de-obfuscation.

In your build pipeline, run the CLI tool:

```bash
npx @hyperdx/cli upload-sourcemaps \
  --serviceKey "$HYPERDX_API_ACCESS_KEY" \
  --apiUrl "$HYPERDX_API_URL" \
  --path .next \
  --releaseId "$RELEASE_ID"
```

You can also add this as an npm script:

```json
{
  "scripts": {
    "upload-sourcemaps": "npx @hyperdx/cli upload-sourcemaps --path=\".next\""
  }
}
```

### Options

| Flag                      | Description                                            | Default |
| ------------------------- | ------------------------------------------------------ | ------- |
| `-k, --serviceKey <key>`  | HyperDX service account API key                        |         |
| `-p, --path <dir>`        | Directory containing sourcemaps                        | `.`     |
| `-u, --apiUrl <url>`      | HyperDX API URL (required for self-hosted deployments) |         |
| `-rid, --releaseId <id>`  | Release ID to associate with the sourcemaps            |         |
| `-bp, --basePath <path>`  | Base path for the uploaded sourcemaps                  |         |

Optionally, set the `HYPERDX_SERVICE_KEY` environment variable to avoid passing
the `--serviceKey` flag.
