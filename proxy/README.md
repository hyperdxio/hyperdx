# Proxy Configuration

This directory contains configurations for running the HyperDX frontend behind a
reverse proxy that serves the application under a specific subpath. This is
useful for deployments where HyperDX is not at the root of a domain (e.g.,
`http://example.com/hyperdx`).

We provide configurations for two popular reverse proxies:

- [Nginx](./nginx/nginx.conf.template)
- [Traefik](./traefik/config.yml)

## Environment Variables

To configure the subpath, you need to set the following environment variables in
your `.env` file.

### `HYPERDX_BASE_PATH` and `NEXT_PUBLIC_HYPERDX_BASE_PATH`

To serve the application from a subpath, two environment variables must be set
to the **same value**:

1.  `HYPERDX_BASE_PATH`: This is used by the reverse proxy (Nginx or Traefik) to
    handle path routing and rewriting.
2.  `NEXT_PUBLIC_HYPERDX_BASE_PATH`: This is used by the Next.js application to
    generate correct asset links and API routes.

- The value **must** start with a `/` if it's not an empty string (ex:
  `/hyperdx`).
- If you want to serve from the root, you can omit these variables or set them
  to `/`.

### `FRONTEND_URL`

This variable should be set to the full public URL of the frontend, including
the subpath. The API server uses this URL for various purposes such as
generating absolute URLs for redirects, links in emails, or alerts.

- It should be a full URL, including the protocol (`http` or `https`).
- It should include the subpath defined in `HYPERDX_BASE_PATH`.

**Example `.env` Configuration:**

For local development with the subpath `/hyperdx`, your configuration would look
like this:

```
HYPERDX_BASE_PATH=/hyperdx
NEXT_PUBLIC_HYPERDX_BASE_PATH=/hyperdx
FRONTEND_URL=http://localhost:4040/hyperdx
```

## How It Works

The proxy configurations are designed to handle subpath routing with minimal
changes to the application code. Here's a high-level overview of the logic:

1.  **Root Redirect**: If a subpath is configured (e.g., `/hyperdx`), any
    requests to the root (`/`) are automatically redirected to that subpath.
    This ensures users always land on the correct URL.

2.  **Path Rewriting**: The application's frontend code sometimes makes requests
    to root-level paths (e.g., `/api/...` or `/_next/...`). The proxy intercepts
    these requests, prepends the configured subpath, and forwards them to the
    Next.js server. For example, a request for `/_next/static/chunk.js` becomes
    a request for `/hyperdx/_next/static/chunk.js` before being sent to the
    application.

3.  **Direct Proxy**: Any requests that already include the correct subpath are
    passed directly to the Next.js application, which is configured via
    `basePath` to handle them correctly.

This setup allows the frontend application to be developed as if it were running
at the root, while the proxy transparently manages the subpath routing.
