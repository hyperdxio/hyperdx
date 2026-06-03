import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

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
    expect(screen.getByText(/^Connect your AI assistant$/)).toBeInTheDocument();
  });

  it('renders nothing while the me payload is still loading', () => {
    setMe(null, true);

    renderSection();

    expect(screen.queryByTestId('mcp-server-section')).not.toBeInTheDocument();
  });

  it('renders all five host options when the deployment shape is valid', () => {
    renderSection();

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('VS Code + Copilot')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('renders the sign-in alert when no access key is loaded', () => {
    setMe(null);

    renderSection();

    expect(
      screen.getByText(/Sign in to load your personal access key/i),
    ).toBeInTheDocument();
  });

  it('renders the fixed clickstack server name in the install snippet', () => {
    renderSection();

    expect(screen.getByText(/claude mcp add clickstack /)).toBeInTheDocument();
  });

  it('renders the no-access-key alert when me is loaded but accessKey is empty', () => {
    setMe('');

    renderSection();

    expect(
      screen.getByText(/No access key on this account yet/i),
    ).toBeInTheDocument();
  });
});
