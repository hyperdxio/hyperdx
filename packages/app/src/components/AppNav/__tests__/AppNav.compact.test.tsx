import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import AppNav from '@/components/AppNav/AppNav';
import { COMPACT_MAX_WIDTH } from '@/components/CompactViewport/useCompactViewport';
import { useWindowSize } from '@/utils';

const mockRouter = {
  pathname: '/search',
  asPath: '/search',
  query: {} as Record<string, string>,
  push: jest.fn(),
};

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
  useRouter: () => mockRouter,
}));
jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('@hyperdx/browser', () => ({
  __esModule: true,
  default: {
    addAction: jest.fn(),
    enableAdvancedNetworkCapture: jest.fn(),
    setGlobalAttributes: jest.fn(),
  },
}));
jest.mock('@/api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: undefined }) },
}));
jest.mock('@/savedSearch', () => ({
  useSavedSearches: () => ({ data: [] }),
}));
jest.mock('@/dashboard', () => ({ useDashboards: () => ({ data: [] }) }));
jest.mock('@/favorites', () => ({ useFavorites: () => ({ data: [] }) }));
jest.mock('@/OnboardingChecklist', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/InstallInstructionsModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/UserPreferencesModal', () => ({
  UserPreferencesModal: () => null,
}));
jest.mock('@/components/AppNav/AppNavFeedback', () => ({
  AppNavFeedback: () => null,
}));
jest.mock('@/utils', () => ({
  ...jest.requireActual('@/utils'),
  useWindowSize: jest.fn(() => ({ width: undefined, height: undefined })),
}));

const setWidth = (width: number) =>
  jest.mocked(useWindowSize).mockReturnValue({ width, height: 800 });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, enabled: false } },
});
const nav = () => (
  <QueryClientProvider client={queryClient}>
    <AppNav fixed />
  </QueryClientProvider>
);
const renderNav = () => renderWithMantine(nav());

const toggleButton = () => screen.getByTitle('Collapse/Expand Navigation');
const overlay = () => screen.queryByTestId('app-nav-overlay');

const openNav = () => {
  fireEvent.click(toggleButton());
  expect(overlay()).toBeInTheDocument();
};

describe('AppNav below the compact width', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRouter.pathname = '/search';
    mockRouter.asPath = '/search';
    setWidth(COMPACT_MAX_WIDTH - 1);
  });

  it('opens over the page as a modal dialog tied to the expand button', () => {
    renderNav();
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openNav();
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
    expect(toggleButton()).toHaveAttribute('aria-controls', dialog.id);
  });

  it('moves focus into the open nav and back to the expand button', async () => {
    renderNav();
    openNav();
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    fireEvent.keyDown(document.documentElement, { key: 'Escape' });
    expect(overlay()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggleButton());
  });

  it('closes on Escape', () => {
    renderNav();
    openNav();
    fireEvent.keyDown(document.documentElement, { key: 'Escape' });
    expect(overlay()).not.toBeInTheDocument();
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the backdrop is clicked', () => {
    renderNav();
    openNav();
    fireEvent.click(overlay()!);
    expect(overlay()).not.toBeInTheDocument();
  });

  it('closes when the route changes', () => {
    const { rerender } = renderNav();
    openNav();
    act(() => {
      mockRouter.pathname = '/dashboards/list';
      mockRouter.asPath = '/dashboards/list';
    });
    rerender(<TestProviders>{nav()}</TestProviders>);
    expect(overlay()).not.toBeInTheDocument();
  });

  it('stays open when a favorites chevron is clicked', () => {
    renderNav();
    openNav();
    fireEvent.click(screen.getByTestId('nav-link-search-list-toggle'));
    expect(overlay()).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('nav-link-dashboards-list-toggle'));
    expect(overlay()).toBeInTheDocument();
  });
});

describe('AppNav at or above the compact width', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setWidth(COMPACT_MAX_WIDTH);
  });

  it('collapses in place without a backdrop or a dialog', () => {
    renderNav();
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggleButton());
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
