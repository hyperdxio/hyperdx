import React from 'react';
import { screen } from '@testing-library/react';

import { AppNavContext, AppNavUserMenu } from '../AppNav/AppNav.components';

const renderAppNavUserMenu = (userName?: string) => {
  return renderWithMantine(
    <AppNavContext.Provider value={{ isCollapsed: false, pathname: '/' }}>
      <AppNavUserMenu userName={userName} teamName="HyperDX" />
    </AppNavContext.Provider>,
  );
};

describe('AppNavUserMenu', () => {
  it('renders initials for multi-word names with extra whitespace', () => {
    renderAppNavUserMenu('  Ernest   Iliiasov  ');

    expect(screen.getByText('EI')).toBeInTheDocument();
    expect(screen.getByText(/Ernest\s+Iliiasov/)).toBeInTheDocument();
  });

  it('falls back to the default user label for blank names', () => {
    renderAppNavUserMenu('   ');

    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });
});
