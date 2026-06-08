// Per-host snippet builders for the "Connect your AI assistant"
// section. Each builder takes a `DeploymentShape` (URL + access
// key) and returns the install primitive for one host: a CLI
// one-liner, a deep link, or a JSON config block.
//
// Pure functions only. Component-level state (host picker) lives
// in `McpInstallPanel.tsx`. Keeping the builders here makes unit
// tests cheap and keeps the snippet round-trip stable regardless
// of which surface renders them.

/**
 * MCP server name registered in the host's config. A single fixed
 * value works because the access key carries the team context to
 * the MCP server: every install snippet reaches the same
 * `/api/mcp` endpoint and the server resolves the active team
 * from the bearer token. A user with multiple ClickStack tenants
 * authenticates as a different identity per host config and the
 * server routes accordingly, so we don't need to disambiguate by
 * name on the client.
 */
export const SERVER_NAME = 'clickstack';

export interface DeploymentShape {
  /** Origin used to build the MCP URL, e.g. `https://example.com/api`. */
  apiUrl: string;
  /** Per-user access key from `useMe().accessKey`. */
  accessKey: string;
}

export interface BuiltSnippets {
  /** Claude Code CLI one-liner. */
  claudeCode: string;
  /** Cursor `cursor://` deep link. */
  cursor: string;
  /** VS Code + Copilot `vscode:mcp/install` deep link. */
  vscode: string;
  /** OpenAI Codex CLI one-liner. */
  codexCli: string;
  /** OpenCode JSON config under an `mcp` block (uses `type: "remote"`). */
  openCode: string;
  /** Canonical `mcpServers` JSON block for any other host. */
  jsonBlock: string;
}

/**
 * Encodes a config object the way the Cursor MCP deep link expects:
 * `cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=<base64>`.
 * Runs in both the browser (`btoa`) and Node (`Buffer`) so the
 * snippet builders are usable from Jest tests without a JSDOM
 * polyfill.
 *
 * UTF-8-encodes the input before `btoa` so a future access-key or
 * origin format that includes a code point > 0xFF cannot raise
 * `InvalidCharacterError` and blank the whole panel (since
 * `buildAllSnippets` builds every host eagerly). Today's inputs
 * (UUIDv4 key + browser-normalised origin) are all Latin1 so the
 * defensive path is unreachable, but the encode is cheap.
 */
function base64(value: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const utf8 = new TextEncoder().encode(value);
    let binary = '';
    for (let i = 0; i < utf8.length; i++) {
      binary += String.fromCharCode(utf8[i]);
    }
    return window.btoa(binary);
  }
  return Buffer.from(value, 'utf8').toString('base64');
}

/**
 * URL-safe base64. Standard base64 emits `+`, `/`, `=`, all of
 * which carry special meaning in a query-string value (`+` decodes
 * as space on the deep-link host side, breaking the JSON payload).
 * Cursor's deep-link decoder accepts the URL-safe alphabet; emitting
 * it directly avoids a separate `encodeURIComponent` round on the
 * already-encoded value.
 */
function base64UrlSafe(value: string): string {
  return base64(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Returns the headers map for the MCP HTTP transport. The
 * deployment shape exposed by `useMe()` carries only the bearer
 * access key, so `Authorization` is the only header emitted here.
 */
function buildHeaders(deployment: DeploymentShape): Record<string, string> {
  return {
    Authorization: `Bearer ${deployment.accessKey || '<accessKey>'}`,
  };
}

/**
 * Returns the MCP URL the host connects to. `apiUrl` is the API
 * origin derived from the active page; the MCP transport lives at
 * `/mcp` underneath it.
 */
function buildUrl(deployment: DeploymentShape): string {
  const base = deployment.apiUrl.endsWith('/')
    ? deployment.apiUrl.slice(0, -1)
    : deployment.apiUrl;
  return `${base}/mcp`;
}

/**
 * Quote and escape a header value for safe inclusion inside a
 * double-quoted shell argument. Defensive: today's `accessKey` is
 * a UUIDv4 with no shell metacharacters, but a future format that
 * permits `"`, `$`, `\`, or backtick would otherwise turn a
 * copy-paste install into a shell-injection vector.
 */
function shellQuoteHeader(name: string, value: string): string {
  const escaped = value.replace(/(["\\$`])/g, '\\$1');
  return `--header "${name}: ${escaped}"`;
}

function headerArgs(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => shellQuoteHeader(key, value))
    .join(' ');
}

/**
 * Shared one-liner builder for CLI hosts whose `mcp add` primitive
 * matches Claude Code's documented shape: `<binary> mcp add <name>
 * --transport http <url> --header "..."`. Codex CLI mirrors this
 * verbatim (see https://developers.openai.com/codex/mcp), so the
 * two hosts share the same generator and differ only in the binary
 * name.
 */
function buildCliOneLiner(binary: string, deployment: DeploymentShape): string {
  const url = buildUrl(deployment);
  const headers = buildHeaders(deployment);
  return `${binary} mcp add ${SERVER_NAME} --transport http ${url} ${headerArgs(headers)}`;
}

/**
 * Cursor `cursor://` deep link. Documented Cursor MCP install
 * scheme: name in the query string, config as base64-encoded JSON.
 *
 * Uses URL-safe base64 (`-`, `_`, no padding) for the `config` value
 * so the standard alphabet's `+` / `/` / `=` cannot be re-interpreted
 * by the deep-link host's URL parser. Notably, `+` decodes as space
 * under `application/x-www-form-urlencoded`, which corrupts the
 * embedded JSON.
 */
function buildCursorDeeplink(deployment: DeploymentShape): string {
  const config = {
    type: 'http',
    url: buildUrl(deployment),
    headers: buildHeaders(deployment),
  };
  const encoded = base64UrlSafe(JSON.stringify(config));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encoded}`;
}

/**
 * VS Code + Copilot `vscode:mcp/install` deep link. Requires VS
 * Code 1.99+ with the Copilot Chat MCP feature enabled.
 */
function buildVSCodeDeeplink(deployment: DeploymentShape): string {
  const config = {
    name: SERVER_NAME,
    type: 'http',
    url: buildUrl(deployment),
    headers: buildHeaders(deployment),
  };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * OpenCode JSON config block. OpenCode's MCP config lives under an
 * `mcp` key (not `mcpServers`) and uses `type: "remote"` for HTTP
 * transport (documented at https://opencode.ai/docs/mcp-servers/).
 * Verified empirically against a running ClickStack instance on
 * 2026-06-04: OpenCode's `type: "remote"` connects successfully to
 * our Streamable HTTP server.
 *
 * Users paste this into `opencode.json` in their project root, or
 * into `~/.config/opencode/config.json` for a global install.
 */
function buildOpenCodeJsonBlock(deployment: DeploymentShape): string {
  const block = {
    mcp: {
      [SERVER_NAME]: {
        type: 'remote',
        url: buildUrl(deployment),
        headers: buildHeaders(deployment),
      },
    },
  };
  return JSON.stringify(block, null, 2);
}

/**
 * Canonical `mcpServers` JSON block. Covers every MCP-compatible
 * host that doesn't have a CLI primitive or deep link yet (Claude
 * Desktop, Continue, Cline, and the long tail).
 */
function buildMcpJsonBlock(deployment: DeploymentShape): string {
  const block = {
    mcpServers: {
      [SERVER_NAME]: {
        url: buildUrl(deployment),
        type: 'http',
        headers: buildHeaders(deployment),
      },
    },
  };
  return JSON.stringify(block, null, 2);
}

/**
 * Build every host's snippet in one call. The component pulls the
 * field matching the current host out of the result; tests assert
 * round-trip shape through this entry point.
 */
export function buildAllSnippets(deployment: DeploymentShape): BuiltSnippets {
  return {
    claudeCode: buildCliOneLiner('claude', deployment),
    cursor: buildCursorDeeplink(deployment),
    vscode: buildVSCodeDeeplink(deployment),
    codexCli: buildCliOneLiner('codex', deployment),
    openCode: buildOpenCodeJsonBlock(deployment),
    jsonBlock: buildMcpJsonBlock(deployment),
  };
}
