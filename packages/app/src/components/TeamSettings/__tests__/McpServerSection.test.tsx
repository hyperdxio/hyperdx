import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';

import McpServerSection from '../McpServerSection';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
  hdxServer: jest.fn(),
}));

const mockUseMe = jest.mocked(api.useMe);

function setMe(accessKey: string | null, isLoading = false) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  mockUseMe.mockReturnValue({
    data:
      accessKey === null
        ? null
        : {
            id: 'u1',
            email: 'a@b.com',
            accessKey,
            name: 'User',
            createdAt: '',
          },
    isLoading,
  } as ReturnType<typeof api.useMe>);
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <McpServerSection />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('McpServerSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMe('k_test');
  });

  it('renders the section header and the install panel', () => {
    renderSection();

    expect(screen.getByTestId('mcp-server-section')).toBeInTheDocument();
    expect(screen.getByText(/^Connect your AI Agents$/)).toBeInTheDocument();
  });

  it('renders nothing while the me payload is still loading', () => {
    setMe(null, true);

    renderSection();

    expect(screen.queryByTestId('mcp-server-section')).not.toBeInTheDocument();
  });

  it('renders all six host options when the deployment shape is valid', () => {
    renderSection();

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('VS Code')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  // Auth-gate parity with `ApiKeysSection`: when `me` resolves to
  // `null` (user not signed in, or `IS_LOCAL_MODE` short-circuit),
  // the section silently doesn't render. No "sign in" alert.
  it('renders nothing when me is null', () => {
    setMe(null);

    renderSection();

    expect(screen.queryByTestId('mcp-server-section')).not.toBeInTheDocument();
  });

  it('renders the fixed clickstack server name in the install snippet', () => {
    renderSection();

    expect(screen.getByText(/claude mcp add clickstack /)).toBeInTheDocument();
  });

  // `MeApiResponseSchema.accessKey` is `z.string()` non-nullable
  // and the User model generates one at account creation, so an
  // empty access key isn't reachable from the API in practice.
  // The defensive guard in `McpServerSection` still skips render
  // rather than emitting a snippet with an empty bearer.
  it('renders nothing when accessKey is empty', () => {
    setMe('');

    renderSection();

    expect(screen.queryByTestId('mcp-server-section')).not.toBeInTheDocument();
  });

  it('switches to the Codex CLI snippet when the host picker selects Codex CLI', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('Codex CLI'));

    expect(screen.getByText(/codex mcp add clickstack /)).toBeInTheDocument();
    expect(
      screen.queryByText(/^claude mcp add clickstack /),
    ).not.toBeInTheDocument();
  });

  it('renders the Cursor deeplink button with a cursor:// href when Cursor is selected', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('Cursor'));

    const button = screen.getByRole('link', { name: /Add to Cursor/i });
    const href = button.getAttribute('href') ?? '';
    expect(href).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=clickstack&config=[-A-Za-z0-9_]+$/,
    );
  });

  it('renders the VS Code deeplink button with a vscode:mcp/install href when VS Code is selected', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('VS Code'));

    const button = screen.getByRole('link', { name: /Add to VS Code/i });
    expect(button.getAttribute('href') ?? '').toMatch(/^vscode:mcp\/install\?/);
  });

  it('renders the canonical JSON block when Other is selected', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('Other'));

    expect(screen.getByText(/"mcpServers":/)).toBeInTheDocument();
  });

  it('renders the OpenCode JSON block (`mcp` key with `type: "remote"`) when OpenCode is selected', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('OpenCode'));

    // OpenCode's shape diverges from `Other`: outer key is `mcp`
    // (not `mcpServers`) and the server entry uses `type: "remote"`
    // (not `type: "http"`).
    expect(screen.getByText(/"mcp":/)).toBeInTheDocument();
    expect(screen.getByText(/"type": "remote"/)).toBeInTheDocument();
  });

  it('reveals the manual JSON fallback when the Manual setup toggle is clicked on a deeplink host', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByText('Cursor'));
    // The fallback JSON lives inside Mantine's `<Collapse>`, which
    // keeps the child mounted and animates max-height + visibility
    // for the open transition. JSDOM does not run CSS transitions,
    // so the canonical "is the user seeing it" canary is the toggle
    // label: it flips synchronously with React state.
    expect(screen.getByText(/^Manual setup$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Hide manual setup$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/"mcpServers":/)).not.toBeVisible();

    await user.click(screen.getByText(/^Manual setup$/i));
    expect(screen.getByText(/^Hide manual setup$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Manual setup$/i)).not.toBeInTheDocument();

    await user.click(screen.getByText(/^Hide manual setup$/i));
    expect(screen.getByText(/^Manual setup$/i)).toBeInTheDocument();
  });
});
