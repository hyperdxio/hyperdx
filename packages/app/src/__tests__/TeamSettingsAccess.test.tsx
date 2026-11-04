import { screen } from '@testing-library/react';

import TeamPage from '@/TeamPage';

const mockMe = jest.fn();
const mockRouter = {
  query: { tab: 'team' },
  isReady: true,
  pathname: '/team',
  replace: jest.fn(),
};
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/layout', () => ({
  withAppNav: jest.fn(),
  APP_CONTENT_SCROLL_CONTAINER_ID: 'app',
}));
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({ data: mockMe() }),
    useTeam: () => ({
      data: { name: 'Team', allowedAuthMethods: [] },
      isLoading: false,
    }),
    useSetTeamName: () => ({ mutate: jest.fn() }),
  },
}));
jest.mock('@/components/TeamSettings/ApiKeysSection', () => () => null);
jest.mock('@/components/TeamSettings/ConnectionsSection', () => () => null);
jest.mock('@/components/TeamSettings/IacMigrationSection', () => () => null);
jest.mock('@/components/TeamSettings/IntegrationsSection', () => () => null);
jest.mock('@/components/TeamSettings/McpServerSection', () => () => null);
jest.mock(
  '@/components/TeamSettings/SecurityPoliciesSection',
  () => () => null,
);
jest.mock('@/components/TeamSettings/SourcesSection', () => () => null);
jest.mock('@/components/TeamSettings/TeamMembersSection', () => () => null);
jest.mock('@/components/TeamSettings/TeamQueryConfigSection', () => () => null);

describe('team settings tabs', () => {
  beforeEach(() => {
    mockRouter.replace.mockClear();
    mockRouter.query = { tab: 'team' };
  });

  it.each([
    ['team', 'Members'],
    ['data', 'Data'],
    ['integrations', 'Integrations'],
  ])(
    'preserves the %s deep link while administrator permissions load',
    (tab, name) => {
      mockRouter.query = { tab };
      mockMe.mockReturnValue(undefined);
      const { rerender } = renderWithMantine(<TeamPage />);
      expect(mockRouter.replace).not.toHaveBeenCalled();
      mockMe.mockReturnValue({ canManageTeamSettings: true });
      rerender(
        <TestProviders>
          <TeamPage />
        </TestProviders>,
      );
      expect(screen.getByRole('tab', { name })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(mockRouter.replace).not.toHaveBeenCalled();
    },
  );
  it.each([false, undefined])(
    'hides restricted tabs without granted access (%s), including direct links',
    allowed => {
      mockMe.mockReturnValue(
        allowed === undefined ? undefined : { canManageTeamSettings: allowed },
      );
      renderWithMantine(<TeamPage />);
      for (const name of ['Members', 'Data', 'Integrations']) {
        expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
      }
      expect(screen.getByRole('tab', { name: 'API & Agents' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    },
  );

  it('shows the three management tabs for authorized users', () => {
    mockMe.mockReturnValue({ canManageTeamSettings: true });
    renderWithMantine(<TeamPage />);
    for (const name of ['Members', 'Data', 'Integrations']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it.each([
    ['team', 'Members'],
    ['data', 'Data'],
    ['integrations', 'Integrations'],
  ])('leaves the active %s tab when permission is revoked', (tab, name) => {
    mockRouter.query = { tab };
    mockMe.mockReturnValue({ canManageTeamSettings: true });
    const { rerender } = renderWithMantine(<TeamPage />);
    expect(screen.getByRole('tab', { name })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    mockMe.mockReturnValue({ canManageTeamSettings: false });
    rerender(
      <TestProviders>
        <TeamPage />
      </TestProviders>,
    );
    expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'API & Agents' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: { tab: 'api-agents' } }),
      undefined,
      { shallow: true, scroll: false },
    );
  });
});
