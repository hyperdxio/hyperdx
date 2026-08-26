import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreSqlToggle } from '@/components/Explore/ExploreSqlToggle';

describe('ExploreSqlToggle', () => {
  it('reads as plain SQL while the query is generated', () => {
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={jest.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'SQL' });
    expect(button).toHaveTextContent('SQL');
    expect(button).not.toHaveTextContent('edited');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('announces the query as edited once the user owns it', () => {
    renderWithMantine(<ExploreSqlToggle open edited onToggle={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'SQL, edited' });
    expect(button).toHaveTextContent('SQL edited');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles the panel when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    renderWithMantine(
      <ExploreSqlToggle open={false} edited={false} onToggle={onToggle} />,
    );

    await user.click(screen.getByRole('button', { name: 'SQL' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
