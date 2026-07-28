import {
  buildAllSnippets,
  CODEX_TOKEN_ENV_VAR,
  type DeploymentShape,
  SERVER_NAME,
} from '@/components/ClickStackOnboarding/installSnippets';

const DEPLOYMENT: DeploymentShape = {
  apiUrl: 'https://hyperdx.example.com/api',
  accessKey: 'k_abcdef123456',
};

describe('buildAllSnippets > Claude Code', () => {
  it('emits the documented Claude Code MCP install one-liner', () => {
    const { claudeCode } = buildAllSnippets(DEPLOYMENT);

    expect(claudeCode).toBe(
      `claude mcp add ${SERVER_NAME} --transport http https://hyperdx.example.com/api/mcp --header "Authorization: Bearer k_abcdef123456"`,
    );
  });
});

describe('buildAllSnippets > Codex CLI', () => {
  it('emits the current OpenAI Codex CLI mcp add command with a bearer-token env var', () => {
    const { codexCli } = buildAllSnippets(DEPLOYMENT);

    expect(codexCli).toBe(
      `export ${CODEX_TOKEN_ENV_VAR}="k_abcdef123456"\n` +
        `codex mcp add ${SERVER_NAME} --url https://hyperdx.example.com/api/mcp --bearer-token-env-var ${CODEX_TOKEN_ENV_VAR}`,
    );
  });

  it('does NOT use the deprecated --transport or --header flags', () => {
    const { codexCli } = buildAllSnippets(DEPLOYMENT);

    expect(codexCli).not.toContain('--transport');
    expect(codexCli).not.toContain('--header');
  });
});

describe('buildAllSnippets > Cursor', () => {
  it('emits a cursor:// URL with a URL-safe base64-encoded config that round-trips', () => {
    const { cursor } = buildAllSnippets(DEPLOYMENT);

    expect(
      cursor.startsWith(
        `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=`,
      ),
    ).toBe(true);

    const encoded = cursor.split('config=')[1];
    // base64url accepts both the URL-safe alphabet (`-`, `_`, no
    // padding) and standard base64; using it explicitly is the
    // documented decoder for the URL-safe variant we emit.
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    expect(decoded).toMatchObject({
      type: 'http',
      url: 'https://hyperdx.example.com/api/mcp',
      headers: { Authorization: 'Bearer k_abcdef123456' },
    });
  });

  it('produces a Cursor config value that only uses the URL-safe alphabet', () => {
    // The standard base64 characters `+` / `/` / `=` all carry
    // special meaning inside a query-string value (`+` decodes as
    // space under form-urlencoded), so the deep link must use the
    // URL-safe variant. This guards every input that flows through
    // `buildAllSnippets`, not just the canonical fixture.
    const inputs: DeploymentShape[] = [
      DEPLOYMENT,
      // Inputs chosen to maximise the chance that the standard
      // base64 alphabet would emit `+` or `/`. Every byte > 0x3E or
      // > 0x3F flips a `+` or `/` somewhere in the encoded output.
      {
        apiUrl: 'https://hyperdx.example.com/api',
        accessKey: '????>>>>????>>>>',
      },
      {
        apiUrl: 'https://hyperdx.example.com/api',
        accessKey: 'ÿÿÿÿÿÿ',
      },
    ];
    for (const deployment of inputs) {
      const { cursor } = buildAllSnippets(deployment);
      const encoded = cursor.split('config=')[1];
      expect(encoded).toMatch(/^[-A-Za-z0-9_]+$/);
    }
  });
});

describe('buildAllSnippets > VS Code', () => {
  it('emits a vscode:mcp/install URL with a URL-encoded JSON config that round-trips', () => {
    const { vscode } = buildAllSnippets(DEPLOYMENT);

    expect(vscode.startsWith('vscode:mcp/install?')).toBe(true);

    const encoded = vscode.replace(/^vscode:mcp\/install\?/, '');
    const decoded = JSON.parse(decodeURIComponent(encoded));
    expect(decoded).toMatchObject({
      name: SERVER_NAME,
      type: 'http',
      url: 'https://hyperdx.example.com/api/mcp',
      headers: { Authorization: 'Bearer k_abcdef123456' },
    });
  });
});

describe('buildAllSnippets > OpenCode', () => {
  it('emits OpenCode JSON config under an `mcp` block with type: "remote"', () => {
    const { openCode } = buildAllSnippets(DEPLOYMENT);
    const parsed = JSON.parse(openCode);

    // OpenCode reads MCP servers from the `mcp` key (not
    // `mcpServers` like the canonical block) and uses
    // `type: "remote"` for HTTP transport. Verified empirically
    // against a running ClickStack instance 2026-06-04.
    expect(parsed).toMatchObject({
      mcp: {
        [SERVER_NAME]: {
          type: 'remote',
          url: 'https://hyperdx.example.com/api/mcp',
          headers: { Authorization: 'Bearer k_abcdef123456' },
        },
      },
    });
  });

  it('does NOT emit type: "http" or an `mcpServers` key (those would be the wrong shape for OpenCode)', () => {
    const { openCode } = buildAllSnippets(DEPLOYMENT);

    expect(openCode).not.toContain('"type": "http"');
    expect(openCode).not.toContain('"mcpServers"');
  });
});

describe('buildAllSnippets > JSON block', () => {
  it('emits canonical mcpServers JSON keyed on the fixed server name', () => {
    const { jsonBlock } = buildAllSnippets(DEPLOYMENT);
    const parsed = JSON.parse(jsonBlock);

    expect(parsed).toMatchObject({
      mcpServers: {
        [SERVER_NAME]: {
          url: 'https://hyperdx.example.com/api/mcp',
          type: 'http',
          headers: { Authorization: 'Bearer k_abcdef123456' },
        },
      },
    });
  });

  it('renders pretty-printed JSON with two-space indent', () => {
    const { jsonBlock } = buildAllSnippets(DEPLOYMENT);

    expect(jsonBlock).toContain('\n  "mcpServers": {');
  });
});

describe('buildAllSnippets > placeholder fallbacks', () => {
  it('falls back to <accessKey> in the snippet when the key is empty', () => {
    const { claudeCode } = buildAllSnippets({ ...DEPLOYMENT, accessKey: '' });

    expect(claudeCode).toContain('Bearer <accessKey>');
  });

  it('falls back to <accessKey> in the Codex export when the key is empty', () => {
    const { codexCli } = buildAllSnippets({ ...DEPLOYMENT, accessKey: '' });

    expect(codexCli).toContain(`export ${CODEX_TOKEN_ENV_VAR}="<accessKey>"`);
  });

  it('escapes shell metacharacters in header values', () => {
    // Today's access keys are UUIDv4 with no metacharacters; the
    // escape is defensive against future formats that allow `"`,
    // `$`, `\`, or backtick. Any of those would otherwise turn a
    // copy-paste install into a shell-injection vector.
    const { claudeCode } = buildAllSnippets({
      ...DEPLOYMENT,
      accessKey: 'k"$`\\suffix',
    });

    expect(claudeCode).toContain('Bearer k\\"\\$\\`\\\\suffix"');
  });

  it('escapes shell metacharacters in the Codex export value', () => {
    // The bearer token lands on the right-hand side of an `export`,
    // so the same shell-injection defense applies to the Codex
    // snippet's quoted value.
    const { codexCli } = buildAllSnippets({
      ...DEPLOYMENT,
      accessKey: 'k"$`\\suffix',
    });

    expect(codexCli).toContain(
      'export ' + CODEX_TOKEN_ENV_VAR + '="k\\"\\$\\`\\\\suffix"',
    );
  });
});

describe('buildAllSnippets > host coverage', () => {
  it('returns a populated string for every supported host', () => {
    const all = buildAllSnippets(DEPLOYMENT);

    expect(all).toMatchObject({
      claudeCode: expect.stringContaining(`claude mcp add ${SERVER_NAME}`),
      cursor: expect.stringContaining('cursor://'),
      vscode: expect.stringContaining('vscode:mcp/install'),
      codexCli: expect.stringContaining(`codex mcp add ${SERVER_NAME}`),
      openCode: expect.stringContaining(`"${SERVER_NAME}"`),
      jsonBlock: expect.stringContaining(`"${SERVER_NAME}"`),
    });
  });

  it('keys the JSON block on the same fixed server name in every output', () => {
    const all = buildAllSnippets(DEPLOYMENT);

    expect(all.claudeCode).toContain(SERVER_NAME);
    expect(all.codexCli).toContain(SERVER_NAME);
    expect(all.cursor).toContain(`name=${SERVER_NAME}`);
    expect(all.vscode).toContain(SERVER_NAME);
    expect(all.openCode).toContain(`"${SERVER_NAME}"`);
    expect(all.jsonBlock).toContain(`"${SERVER_NAME}"`);
  });
});
