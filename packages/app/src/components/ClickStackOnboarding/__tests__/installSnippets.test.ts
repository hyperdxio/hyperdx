import {
  buildAllSnippets,
  type DeploymentShape,
  SERVER_NAME,
} from '../installSnippets';

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
  it('emits the OpenAI Codex CLI mcp add command', () => {
    const { codexCli } = buildAllSnippets(DEPLOYMENT);

    expect(codexCli).toBe(
      `codex mcp add ${SERVER_NAME} --transport http https://hyperdx.example.com/api/mcp --header "Authorization: Bearer k_abcdef123456"`,
    );
  });
});

describe('buildAllSnippets > Cursor', () => {
  it('emits a cursor:// URL with a base64-encoded config that round-trips', () => {
    const { cursor } = buildAllSnippets(DEPLOYMENT);

    expect(
      cursor.startsWith(
        `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=`,
      ),
    ).toBe(true);

    const encoded = cursor.split('config=')[1];
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(decoded).toMatchObject({
      type: 'http',
      url: 'https://hyperdx.example.com/api/mcp',
      headers: { Authorization: 'Bearer k_abcdef123456' },
    });
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
});

describe('buildAllSnippets > host coverage', () => {
  it('returns a populated string for every supported host', () => {
    const all = buildAllSnippets(DEPLOYMENT);

    expect(all).toMatchObject({
      claudeCode: expect.stringContaining(`claude mcp add ${SERVER_NAME}`),
      cursor: expect.stringContaining('cursor://'),
      vscode: expect.stringContaining('vscode:mcp/install'),
      codexCli: expect.stringContaining(`codex mcp add ${SERVER_NAME}`),
      jsonBlock: expect.stringContaining(`"${SERVER_NAME}"`),
    });
  });

  it('keys the JSON block on the same fixed server name in every output', () => {
    const all = buildAllSnippets(DEPLOYMENT);

    expect(all.claudeCode).toContain(SERVER_NAME);
    expect(all.codexCli).toContain(SERVER_NAME);
    expect(all.cursor).toContain(`name=${SERVER_NAME}`);
    expect(all.vscode).toContain(SERVER_NAME);
    expect(all.jsonBlock).toContain(`"${SERVER_NAME}"`);
  });
});
