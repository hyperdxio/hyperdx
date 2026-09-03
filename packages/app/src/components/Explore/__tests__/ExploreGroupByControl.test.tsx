import { screen } from '@testing-library/react';

import { ExploreGroupByControl } from '@/components/Explore/ExploreGroupByControl';

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useMultipleAllFields: jest.fn().mockReturnValue({ data: [] }),
}));

describe('ExploreGroupByControl', () => {
  it('names the operation, not just the field', () => {
    renderWithMantine(
      <ExploreGroupByControl value="SeverityText" onApply={jest.fn()} />,
    );

    // "Group by" is a static addon beside the button rather than inside it, so
    // the button carries the whole phrase as its accessible name.
    expect(
      screen.getByRole('button', { name: 'Group by SeverityText' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Group by')).toBeVisible();
  });

  it('collapses several fields to a count rather than overrunning the toolbar', () => {
    renderWithMantine(
      <ExploreGroupByControl
        value="SeverityText, ServiceName"
        onApply={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Group by 2 fields' }),
    ).toBeInTheDocument();
  });

  it('shows the default that will be applied, so it is not a secret', () => {
    renderWithMantine(
      <ExploreGroupByControl
        value=""
        defaultGroupBy="SeverityText"
        onApply={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Group by SeverityText' }),
    ).toBeInTheDocument();
  });

  it('says so when there is nothing to fall back to', () => {
    renderWithMantine(<ExploreGroupByControl value="" onApply={jest.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Group by nothing' }),
    ).toBeInTheDocument();
  });

  // Popover.Target clones the trigger and passes props of its own. Spread
  // those after `className` and the target silently loses its layout — the
  // value overflows the field and the chevron wraps onto a second line, which
  // every assertion above still passes straight through.
  it('keeps its own styling once Popover.Target has cloned it', () => {
    renderWithMantine(
      <ExploreGroupByControl value="StatusCode" onApply={jest.fn()} />,
    );

    expect(
      screen.getByRole('button', { name: 'Group by StatusCode' }),
    ).toHaveClass('target');
  });
});
