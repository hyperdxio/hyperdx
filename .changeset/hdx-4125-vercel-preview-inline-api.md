---
"@hyperdx/api": patch
"@hyperdx/app": patch
---

Enable end-to-end PR testing on Vercel previews by inlining the Express API into the Next.js `/api/[...all]` serverless function (opt-in via `HDX_PREVIEW_INLINE_API=true`). Production deploys (Docker fullstack image, standalone Next output) are unchanged — they keep proxying `/api/*` to the separately-deployed API service.

Also realigns `clickhouseProxy.ts` with the upstream EE implementation (modulo CHC and RBAC code paths): query params are now parsed from the request URL via `validateAndSanitizePath()` + `URL.searchParams` instead of `req.query`, which fixes a `Setting all is neither a builtin setting nor started with the prefix 'custom_'` regression on Vercel previews where Next.js's `[...all]` catch-all route polluted `req.query`. Adds path-injection hardening, POST-only enforcement, and exposes `X-ClickHouse-Mixed-Response` / `X-ClickHouse-Service-Unavailable` response headers for the browser ClickHouse client.
