import { screen } from '@testing-library/react';

import AuthPage from '@/AuthPage';
import JoinTeamPage from '@/JoinTeamPage';

const mockInstallation = jest.fn();
const mockRouter = { query: { token: 'invite&token' }, push: jest.fn() };
jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next-seo', () => ({ NextSeo: () => null }));
jest.mock('@/LandingHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useInstallation: () => ({ data: mockInstallation() }),
    useTeam: () => ({ data: undefined, isLoading: false }),
    useRegisterPassword: () => ({ mutate: jest.fn() }),
  },
}));

describe('Keycloak login controls', () => {
  it('preserves password login when Keycloak is disabled', () => {
    mockInstallation.mockReturnValue({ isTeamExisting: true });
    renderWithMantine(<AuthPage action="login" />);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Sign in with Keycloak' }),
    ).not.toBeInTheDocument();
  });

  it('offers both login methods during rollout', () => {
    mockInstallation.mockReturnValue({
      isTeamExisting: true,
      keycloakEnabled: true,
    });
    renderWithMantine(<AuthPage action="login" />);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign in with Keycloak' }),
    ).toHaveAttribute('href', '/api/login/keycloak');
  });

  it.each(['login', 'register'] as const)(
    'hides password controls in required mode on %s',
    action => {
      mockInstallation.mockReturnValue({
        isTeamExisting: true,
        keycloakEnabled: true,
        keycloakRequired: true,
      });
      renderWithMantine(<AuthPage action={action} />);
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Sign in with Keycloak' }),
      ).toBeInTheDocument();
    },
  );

  it('passes the invitation token safely and hides password setup in required mode', () => {
    mockInstallation.mockReturnValue({
      isTeamExisting: true,
      keycloakEnabled: true,
      keycloakRequired: true,
    });
    renderWithMantine(<JoinTeamPage />);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign in with Keycloak' }),
    ).toHaveAttribute('href', '/api/login/keycloak?token=invite%26token');
  });
});
