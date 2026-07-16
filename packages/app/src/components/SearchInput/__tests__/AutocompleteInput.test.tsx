import { useRef } from 'react';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AutocompleteInput from '@/components/SearchInput/AutocompleteInput';

function AutocompleteInputHarness() {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <AutocompleteInput
      inputRef={inputRef}
      value=""
      onChange={jest.fn()}
      aboveSuggestions={<span>Searching for:</span>}
      belowSuggestions={<button type="button">Example</button>}
    />
  );
}

describe('AutocompleteInput', () => {
  it('makes decorative above suggestions click-through', async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <AutocompleteInputHarness />
      </MantineProvider>,
    );

    await user.click(
      screen.getByPlaceholderText('Search your events for anything...'),
    );

    const aboveSuggestions = (await screen.findByText('Searching for:'))
      .parentElement;

    expect(aboveSuggestions).toHaveStyle({ pointerEvents: 'none' });
    expect(aboveSuggestions?.parentElement).toHaveStyle({
      pointerEvents: 'none',
    });
    expect(
      screen.getByRole('button', { name: 'Example', hidden: true })
        .parentElement,
    ).toHaveStyle({ pointerEvents: 'auto' });
  });
});
