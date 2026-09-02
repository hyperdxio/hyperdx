import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreSqlToggle } from '@/components/Explore/ExploreSqlToggle';

describe('ExploreSqlToggle', () => {
  it('stays icon-only while the query is still generated', () => {
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={jest.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'Query editor' });
    expect(button).toHaveTextContent('');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('names the surface, not the language, so it survives a PromQL source', () => {
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={jest.fn()} />,
    );

    expect(screen.queryByRole('button', { name: /SQL/i })).toBeNull();
  });

  it('spells itself out once the user owns the query', () => {
    renderWithMantine(<ExploreSqlToggle open edited onToggle={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'Query editor, edited' });
    expect(button).toHaveTextContent('Query edited');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles the panel when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={onToggle} />,
    );

    await user.click(screen.getByRole('button', { name: 'Query editor' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
