import { type ReactNode, useRef, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AutocompleteInput from '@/components/SearchInput/AutocompleteInput';

const DEFAULT_BELOW_SUGGESTIONS = <button type="button">Example</button>;

function AutocompleteInputHarness({
  belowSuggestions = DEFAULT_BELOW_SUGGESTIONS,
}: {
  belowSuggestions?: ReactNode;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [runCount, setRunCount] = useState(0);

  return (
    <>
      <AutocompleteInput
        inputRef={inputRef}
        value=""
        onChange={jest.fn()}
        aboveSuggestions={<span>Searching for:</span>}
        belowSuggestions={belowSuggestions}
      />
      <button type="button" onClick={() => setRunCount(count => count + 1)}>
        Run query
      </button>
      <output>Run executed: {runCount}</output>
    </>
  );
}

describe('AutocompleteInput', () => {
  it('keeps the Run control actionable while the popover is open', async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <AutocompleteInputHarness />
      </MantineProvider>,
    );

    await user.click(
      screen.getByPlaceholderText('Search your events for anything...'),
    );

    await screen.findByText('Searching for:');
    expect(
      screen.getByTestId('autocomplete-below-suggestions'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run query' }));

    expect(screen.getByText('Run executed: 1')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Searching for:')).not.toBeInTheDocument();
    });
  });

  it('does not mount a click target for an empty below-suggestions fragment', async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <AutocompleteInputHarness belowSuggestions={<></>} />
      </MantineProvider>,
    );

    await user.click(
      screen.getByPlaceholderText('Search your events for anything...'),
    );

    await screen.findByText('Searching for:');
    expect(
      screen.queryByTestId('autocomplete-below-suggestions'),
    ).not.toBeInTheDocument();
  });
});
