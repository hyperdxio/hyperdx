import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreSqlToggle } from '@/components/Explore/ExploreSqlToggle';

describe('ExploreSqlToggle', () => {
  it('is a labelled switch that reads as off while closed', () => {
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={jest.fn()} />,
    );

    expect(screen.getByRole('switch', { name: 'Advanced' })).not.toBeChecked();
  });

  it('names the mode, not the language, so it survives a PromQL source', () => {
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={jest.fn()} />,
    );

    expect(screen.queryByRole('switch', { name: /SQL/i })).toBeNull();
  });

  it('reads as on while open, and flags an edited query', () => {
    renderWithMantine(<ExploreSqlToggle open edited onToggle={jest.fn()} />);

    const toggle = screen.getByRole('switch', { name: 'Advanced' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-description', 'Query edited');
  });

  it('toggles the mode when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={onToggle} />,
    );

    await user.click(screen.getByRole('switch', { name: 'Advanced' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
