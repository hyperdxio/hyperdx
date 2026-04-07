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
  --apiVersion v2 \
  --releaseId "$RELEASE_ID"
```

You can also add this as an npm script:

```json
{
  "scripts": {
    "upload-sourcemaps": "npx @hyperdx/cli upload-sourcemaps --apiVersion v2 --path=\".next\""
  }
}
```

### Options

| Flag                      | Description                                               | Default |
| ------------------------- | --------------------------------------------------------- | ------- |
| `-k, --serviceKey <key>`  | HyperDX service account API key                           |         |
| `-p, --path <dir>`        | Directory containing sourcemaps                           | `.`     |
| `-u, --apiUrl <url>`      | HyperDX API URL (required for self-hosted deployments)    |         |
| `-rid, --releaseId <id>`  | Release ID to associate with the sourcemaps               |         |
| `-bp, --basePath <path>`  | Base path for the uploaded sourcemaps                     |         |
| `--apiVersion <version>`  | API version (`v1` for HyperDX V1 Cloud, `v2` for latest) | `v1`    |

> **Note:** Use `--apiVersion v2` for the latest HyperDX app. The `v1` default
> is only for legacy HyperDX V1 Cloud deployments.

Optionally, set the `HYPERDX_SERVICE_KEY` environment variable to avoid passing
the `--serviceKey` flag.
