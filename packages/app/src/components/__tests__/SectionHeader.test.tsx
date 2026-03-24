import React from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SectionHeader from '../SectionHeader';

// Menu buttons have pointer-events:none when not hovered; skip that check.
const user = userEvent.setup({ pointerEventsCheck: 0 });

const makeSection = (
  overrides: Partial<DashboardContainer> = {},
): DashboardContainer => ({
  id: 'section-1',
  type: 'section',
  title: 'My Section',
  collapsed: false,
  ...overrides,
});

describe('SectionHeader', () => {
  it('renders section title and tile count when collapsed', () => {
    renderWithMantine(
      <SectionHeader
        section={makeSection()}
        tileCount={3}
        collapsed={true}
        defaultCollapsed={false}
        onToggle={jest.fn()}
      />,
    );

    expect(screen.getByText('My Section')).toBeInTheDocument();
    expect(screen.getByText('(3 tiles)')).toBeInTheDocument();
  });

  it('does not show tile count when expanded', () => {
    renderWithMantine(
      <SectionHeader
        section={makeSection()}
        tileCount={3}
        collapsed={false}
        defaultCollapsed={false}
        onToggle={jest.fn()}
      />,
    );

    expect(screen.getByText('My Section')).toBeInTheDocument();
    expect(screen.queryByText('(3 tiles)')).not.toBeInTheDocument();
  });

  it('calls onToggle (URL state) when chevron area is clicked', async () => {
    const onToggle = jest.fn();
    const onToggleDefaultCollapsed = jest.fn();

    renderWithMantine(
      <SectionHeader
        section={makeSection()}
        tileCount={2}
        collapsed={false}
        defaultCollapsed={false}
        onToggle={onToggle}
        onToggleDefaultCollapsed={onToggleDefaultCollapsed}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Toggle My Section section/i }),
    );

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggleDefaultCollapsed).not.toHaveBeenCalled();
  });

  it('shows "Collapse by Default" when DB default is expanded', async () => {
    renderWithMantine(
      <SectionHeader
        section={makeSection()}
        tileCount={0}
        collapsed={false}
        defaultCollapsed={false}
        onToggle={jest.fn()}
        onToggleDefaultCollapsed={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    // Open the menu
    await user.click(screen.getByTestId('section-menu-section-1'));
    expect(await screen.findByText('Collapse by Default')).toBeInTheDocument();
  });

  it('shows "Expand by Default" when DB default is collapsed', async () => {
    renderWithMantine(
      <SectionHeader
        section={makeSection({ collapsed: true })}
        tileCount={0}
        collapsed={true}
        defaultCollapsed={true}
        onToggle={jest.fn()}
        onToggleDefaultCollapsed={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await user.click(screen.getByTestId('section-menu-section-1'));
    expect(await screen.findByText('Expand by Default')).toBeInTheDocument();
  });

  it('calls onToggleDefaultCollapsed (DB state) from menu item', async () => {
    const onToggle = jest.fn();
    const onToggleDefaultCollapsed = jest.fn();

    renderWithMantine(
      <SectionHeader
        section={makeSection()}
        tileCount={0}
        collapsed={false}
        defaultCollapsed={false}
        onToggle={onToggle}
        onToggleDefaultCollapsed={onToggleDefaultCollapsed}
        onDelete={jest.fn()}
      />,
    );

    await user.click(screen.getByTestId('section-menu-section-1'));
    await user.click(await screen.findByText('Collapse by Default'));

    expect(onToggleDefaultCollapsed).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('uses collapsed prop for visual state independent of section.collapsed', () => {
    // section.collapsed is false (DB default), but collapsed prop is true (URL override)
    renderWithMantine(
      <SectionHeader
        section={makeSection({ collapsed: false })}
        tileCount={5}
        collapsed={true}
        defaultCollapsed={false}
        onToggle={jest.fn()}
      />,
    );

    // Should show tile count because collapsed=true (URL state takes precedence)
    expect(screen.getByText('(5 tiles)')).toBeInTheDocument();
    // The aria-expanded should reflect the effective state
    expect(
      screen.getByRole('button', { name: /Toggle My Section section/i }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});
