// Per-host snippet builders for the "Connect your AI assistant"
// section. Each builder takes a `DeploymentShape` (URL + access
// key) and returns the install primitive for one host: a CLI
// one-liner, a deep link, or a JSON config block.
//
// Pure functions only. Component-level state (host picker) lives
// in `McpInstallPanel.tsx`. Keeping the builders here makes unit
// tests cheap and keeps the snippet round-trip stable regardless
// of which surface renders them.
//
// Scoped to the self-managed deployment in this PR. The CHC
// managed (BYC) and ClickStack Cloud branches require the CP MCP
// proxy + OAuth-scoped token, tracked as outcome AC18; the
// `DeploymentShape` will gain a `mode` discriminator and CHC
// service-id field in that follow-up.

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
  /** Canonical `mcpServers` JSON block for any other host. */
  jsonBlock: string;
}

/**
 * Encodes a config object the way the Cursor MCP deep link expects:
 * `cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=<base64>`.
 * Runs in both the browser (`btoa`) and Node (`Buffer`) so the
 * snippet builders are usable from Jest tests without a JSDOM
 * polyfill.
 */
function base64(value: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(value);
  }
  return Buffer.from(value).toString('base64');
}

/**
 * Returns the headers map for the MCP HTTP transport. Self-managed
 * mode uses only the `Authorization` header; CHC modes will add
 * `x-service-id` when AC18 (cloud install) lights up.
 */
function buildHeaders(deployment: DeploymentShape): Record<string, string> {
  return {
    Authorization: `Bearer ${deployment.accessKey || '<accessKey>'}`,
  };
}

/**
 * Returns the MCP URL the host connects to. Self-managed talks to
 * the per-tenant origin; CHC modes will route through the CP MCP
 * proxy when AC18 lights up.
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
 * Claude Code one-liner. Documented Claude Code MCP install
 * primitive: `claude mcp add <name> --transport http <url>
 * --header "..."`.
 */
function buildClaudeCodeOneLiner(deployment: DeploymentShape): string {
  const url = buildUrl(deployment);
  const headers = buildHeaders(deployment);
  return `claude mcp add ${SERVER_NAME} --transport http ${url} ${headerArgs(headers)}`;
}

/**
 * OpenAI Codex CLI one-liner. Codex's documented MCP install
 * primitive mirrors Claude Code's pattern. See
 * https://developers.openai.com/codex/mcp for the full reference.
 */
function buildCodexCliOneLiner(deployment: DeploymentShape): string {
  const url = buildUrl(deployment);
  const headers = buildHeaders(deployment);
  return `codex mcp add ${SERVER_NAME} --transport http ${url} ${headerArgs(headers)}`;
}

/**
 * Cursor `cursor://` deep link. Documented Cursor MCP install
 * scheme: name in the query string, config as base64-encoded JSON.
 */
function buildCursorDeeplink(deployment: DeploymentShape): string {
  const config = {
    type: 'http',
    url: buildUrl(deployment),
    headers: buildHeaders(deployment),
  };
  const encoded = base64(JSON.stringify(config));
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
    claudeCode: buildClaudeCodeOneLiner(deployment),
    cursor: buildCursorDeeplink(deployment),
    vscode: buildVSCodeDeeplink(deployment),
    codexCli: buildCodexCliOneLiner(deployment),
    jsonBlock: buildMcpJsonBlock(deployment),
  };
}
