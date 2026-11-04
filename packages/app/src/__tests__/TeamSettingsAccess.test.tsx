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
  beforeEach(() => mockRouter.replace.mockClear());

  it('preserves an administrator deep link until permissions have loaded', () => {
    mockMe.mockReturnValue(undefined);
    renderWithMantine(<TeamPage />);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
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
});
