import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExploreLanguageAddon } from '@/components/Explore/ExploreLanguageAddon';

describe('ExploreLanguageAddon', () => {
  it('opens the syntax reference, so the row needs no separate help icon', async () => {
    const user = userEvent.setup();
    const onOpenSyntaxReference = jest.fn();
    renderWithMantine(
      <ExploreLanguageAddon
        language="sql"
        onOpenSyntaxReference={onOpenSyntaxReference}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Open syntax reference' }),
    );

    expect(onOpenSyntaxReference).toHaveBeenCalledTimes(1);
  });

  it('names the language it documents, so the reference is not a surprise', async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ExploreLanguageAddon language="sql" onOpenSyntaxReference={jest.fn()} />,
    );

    await user.hover(
      screen.getByRole('button', { name: 'Open syntax reference' }),
    );

    expect(await screen.findByText(/SQL WHERE/)).toBeInTheDocument();
  });

  it('says Lucene instead when a saved search brought Lucene with it', async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ExploreLanguageAddon
        language="lucene"
        onOpenSyntaxReference={jest.fn()}
      />,
    );

    await user.hover(
      screen.getByRole('button', { name: 'Open syntax reference' }),
    );

    expect(await screen.findByText(/Lucene/)).toBeInTheDocument();
  });
});
