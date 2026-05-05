import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The MCP Apps UI resource URI for the HyperDX widget.
 *
 * This URI is referenced by the `_meta["ui/resourceUri"]` field on tools that
 * support inline rendering. Hosts that support the MCP Apps extension fetch
 * this resource and render the returned HTML in a sandboxed iframe.
 *
 * Spec: https://modelcontextprotocol.io/extensions/apps/overview
 */
export const HYPERDX_WIDGET_URI = 'ui://hyperdx/widget';

/**
 * MIME type that flags an HTML resource as an MCP App. Hosts that don't
 * recognise this profile will reject the resource with "Unsupported UI
 * resource content format"; they specifically look for the `;profile=mcp-app`
 * suffix to distinguish App resources from arbitrary HTML.
 *
 * Source: `RESOURCE_MIME_TYPE` exported from `@modelcontextprotocol/ext-apps`.
 */
export const HYPERDX_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Tool `_meta` key recognised by MCP Apps hosts to associate a tool with its
 * UI resource. The official ext-apps SDK normalises both this slash-key form
 * and the nested `_meta.ui.resourceUri` form, but at least one host (Claude
 * Desktop) only checks the slash-key form.
 */
export const RESOURCE_URI_META_KEY = 'ui/resourceUri';

/**
 * Resolve the path to the built widget HTML. We try multiple candidates so
 * the same code works in:
 *   - dev (ts-node from packages/api/src)
 *   - jest tests (rootDir = packages/api/src)
 *   - production build (packages/api/build, sibling to packages/mcp-widget/dist)
 */
function resolveWidgetHtmlPath(): string {
  const candidates = [
    // From any compiled location inside packages/api, walk up to the
    // workspace root and into packages/mcp-widget/dist.
    join(__dirname, '../../../../mcp-widget/dist/mcp-app.html'),
    join(__dirname, '../../../mcp-widget/dist/mcp-app.html'),
    // ts-node / jest runs with __dirname = packages/api/src/mcp/ui
    join(__dirname, '../../../../../mcp-widget/dist/mcp-app.html'),
    // Fallback: walk up from CWD (works when run from packages/api).
    join(process.cwd(), '../mcp-widget/dist/mcp-app.html'),
    join(process.cwd(), 'packages/mcp-widget/dist/mcp-app.html'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // try next
    }
  }
  // Last resort: return the most-likely path so readFileSync throws a
  // useful error including the path it tried.
  return candidates[0];
}

// Read the bundled widget HTML once at process start. Re-read in dev when
// the file mtime changes, so `yarn workspace @hyperdx/mcp-widget dev` (Vite
// watch) hot-updates the API without a restart.
let cachedHtml: string | null = null;
let cachedMtimeMs = 0;

function loadWidgetHtml(): string {
  const path = resolveWidgetHtmlPath();
  if (process.env.NODE_ENV !== 'production') {
    try {
      const stat = statSync(path);
      if (cachedHtml != null && stat.mtimeMs === cachedMtimeMs) {
        return cachedHtml;
      }
      cachedMtimeMs = stat.mtimeMs;
    } catch {
      // fall through to readFileSync, which will throw with a real error
    }
  } else if (cachedHtml != null) {
    return cachedHtml;
  }
  cachedHtml = readFileSync(path, 'utf8');
  return cachedHtml;
}

/**
 * Register the HyperDX MCP Apps widget as a UI resource on the given server.
 *
 * The widget is a single-file HTML bundle built by `packages/mcp-widget`
 * (Vite + React + `@modelcontextprotocol/ext-apps`). The host loads it in a
 * sandboxed iframe; the bundle subscribes to `tool/result` events via the
 * SDK's `useApp` hook and renders an inline SVG chart from the
 * `structuredContent` returned by `hyperdx_query`.
 */
export function registerWidget(server: McpServer): void {
  const html = loadWidgetHtml();

  server.registerResource(
    'hyperdx_widget',
    HYPERDX_WIDGET_URI,
    {
      title: 'HyperDX Chart Widget',
      description:
        'Renders observability query results (line, table, number) inline in MCP-Apps-capable hosts.',
      mimeType: HYPERDX_WIDGET_MIME_TYPE,
      // _meta.ui: `McpUiResourceMeta` per the MCP Apps spec.
      //
      // The shape is strict; Claude Desktop validates and rejects unknown
      // fields. Specifically, `permissions` MUST be an object of optional
      // feature flags (camera/microphone/geolocation/clipboardWrite), not
      // an array. We have no external network requests and no browser
      // capabilities to request, so we omit `csp` and ship an empty
      // `permissions` object.
      //
      // `prefersBorder: true` asks the host to render us inside a visible
      // card boundary (matches dashboard tile aesthetics).
      //
      // Opening the "Open in HyperDX" link uses `app.openLink()`, a host
      // capability, not a `permissions` entry.
      _meta: {
        ui: {
          permissions: {},
          prefersBorder: true,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: HYPERDX_WIDGET_URI,
          mimeType: HYPERDX_WIDGET_MIME_TYPE,
          text: html,
        },
      ],
    }),
  );
}
