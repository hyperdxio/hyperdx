import React from 'react';
import {
  setAttributes,
  setUser,
  startNewSession,
} from '@clickhouse/clickstack-browser';
import { fireEvent, screen } from '@testing-library/react';

import {
  AppNavContext,
  AppNavUserMenu,
} from '@/components/AppNav/AppNav.components';

const renderAppNavUserMenu = (userName?: string, logoutUrl?: string) => {
  return renderWithMantine(
    <AppNavContext value={{ isCollapsed: false, pathname: '/' }}>
      <AppNavUserMenu
        userName={userName}
        teamName="HyperDX"
        logoutUrl={logoutUrl}
      />
    </AppNavContext>,
  );
};

describe('AppNavUserMenu', () => {
  it('renders initials for multi-word names with extra whitespace', () => {
    renderAppNavUserMenu('  Ada   Lovelace  ');

    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText(/Ada\s+Lovelace/)).toBeInTheDocument();
  });

  it('falls back to the default user label for blank names', () => {
    renderAppNavUserMenu('   ');

    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('starts a fresh RUM session without the user on logout', async () => {
    renderAppNavUserMenu('Ada Lovelace', '/api/logout');

    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    fireEvent.click(await screen.findByTestId('logout-menu-item'));

    expect(setUser).toHaveBeenCalledWith(null);
    expect(setAttributes).toHaveBeenCalledWith(null);
    expect(startNewSession).toHaveBeenCalledTimes(1);
  });
});
