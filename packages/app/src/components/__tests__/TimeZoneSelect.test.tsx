import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TimeZoneSelect } from '@/components/TimeZoneSelect';

// Tests run with TZ=America/New_York.
const renderSelect = (value: string, onChange = jest.fn()) => {
  renderWithMantine(
    <TimeZoneSelect
      data-testid="time-zone-select"
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
};

const optionNames = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .map(option => option.textContent);

describe('TimeZoneSelect', () => {
  it('shows the local zone for the local setting', () => {
    renderSelect('local');
    expect(screen.getByTestId('time-zone-select')).toHaveValue(
      'Local (America/New York)',
    );
  });

  it('pins local and UTC above the other zones', async () => {
    renderSelect('local');
    await userEvent.click(screen.getByTestId('time-zone-select'));

    const names = optionNames();
    expect(names[0]).toMatch(
      /^Local \(America\/New York\)E[SD]T · UTC-0[45]:00$/,
    );
    expect(names[1]).toBe('UTCUTC+00:00');
    expect(names.slice(2)).toContain('Asia/TokyoUTC+09:00');
    expect(names.filter(name => name?.startsWith('UTC'))).toHaveLength(1);
  });

  it('finds zones by name and reports the IANA value', async () => {
    const { onChange } = renderSelect('local');

    const input = screen.getByTestId('time-zone-select');
    await userEvent.clear(input);
    await userEvent.type(input, 'los ang');
    await userEvent.click(
      await screen.findByRole('option', {
        name: /America\/Los Angeles/,
        hidden: true,
      }),
    );

    expect(onChange).toHaveBeenCalledWith('America/Los_Angeles');
  });

  it('shows local for a zone the browser does not recognise', () => {
    renderSelect('Mars/Olympus_Mons');
    expect(screen.getByTestId('time-zone-select')).toHaveValue(
      'Local (America/New York)',
    );
  });
});
