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

const LOCAL_LABEL = /^Local \(America\/New York\) UTC-[45]$/;

const LOCAL_DEFAULT_LABEL = /^Default \(Local\) UTC-[45]$/;

const inputValue = () =>
  screen.getByTestId<HTMLInputElement>('time-zone-select').value;

describe('TimeZoneSelect', () => {
  it('shows the local zone and its offset for the local setting', () => {
    renderSelect('local');
    expect(inputValue()).toMatch(LOCAL_LABEL);
  });

  it('shows a selected zone with its offset', () => {
    renderSelect('Asia/Tokyo');
    expect(screen.getByTestId('time-zone-select')).toHaveValue(
      'Asia/Tokyo UTC+9',
    );
  });

  it('pins local and UTC above the other zones', async () => {
    renderSelect('local');
    await userEvent.click(screen.getByTestId('time-zone-select'));

    const names = optionNames();
    expect(names[0]).toMatch(/^Local \(America\/New York\)UTC-[45]$/);
    expect(names[1]).toBe('UTC');
    expect(names.slice(2)).toContain('Asia/TokyoUTC+9');
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

  it('finds zones by offset', async () => {
    renderSelect('local');

    const input = screen.getByTestId('time-zone-select');
    await userEvent.clear(input);
    await userEvent.type(input, 'utc+9');

    expect(optionNames()).toContain('Asia/TokyoUTC+9');
    expect(optionNames()).not.toContain('Europe/BerlinUTC+1');
  });

  it.each([
    ['local', LOCAL_DEFAULT_LABEL],
    ['Asia/Tokyo', /^Default \(Asia\/Tokyo\) UTC\+9$/],
    ['Etc/UTC', /^Default \(UTC\)$/],
  ])(
    'names the default option after %s with its offset',
    (defaultTimeZone, label) => {
      renderWithMantine(
        <TimeZoneSelect
          data-testid="time-zone-select"
          value={null}
          onChange={jest.fn()}
          defaultTimeZone={defaultTimeZone}
        />,
      );
      expect(inputValue()).toMatch(label);
    },
  );

  it('shows local for a zone the browser does not recognise', () => {
    renderSelect('Mars/Olympus_Mons');
    expect(inputValue()).toMatch(LOCAL_LABEL);
  });
});
