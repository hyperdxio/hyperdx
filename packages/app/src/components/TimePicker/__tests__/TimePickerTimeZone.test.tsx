import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TimePicker } from '@/components/TimePicker';

let mockOverride: {
  timeZone: string | null;
  setTimeZone: jest.Mock;
} | null = null;
jest.mock('@/timeZoneOverride', () => ({
  useTimeZoneOverride: () => mockOverride,
}));

let mockDisplayTimeZone: string | undefined;
jest.mock('@/useDisplayTimeZone', () => ({
  useDisplayTimeZone: () => mockDisplayTimeZone,
}));

const renderPicker = () => {
  renderWithMantine(
    <TimePicker
      inputValue="Oct 22 14:00:00 - Oct 22 15:00:00"
      setInputValue={jest.fn()}
      onSearch={jest.fn()}
    />,
  );
};

describe('TimePicker time zone override', () => {
  beforeEach(() => {
    mockOverride = null;
    mockDisplayTimeZone = undefined;
  });

  it('shows no time zone without a page override', () => {
    renderPicker();
    fireEvent.click(screen.getByTestId('time-picker-input'));

    expect(screen.queryByTestId('time-picker-time-zone')).toBeNull();
    expect(screen.queryByTestId('time-picker-time-zone-select')).toBeNull();
  });

  it('shows the display zone in the input', () => {
    mockOverride = { timeZone: 'Asia/Tokyo', setTimeZone: jest.fn() };
    mockDisplayTimeZone = 'Asia/Tokyo';
    renderPicker();

    expect(screen.getByTestId('time-picker-time-zone')).toHaveTextContent(
      'UTC+9',
    );
  });

  // Tests run with TZ=America/New_York.
  it.each([
    [undefined, true],
    ['America/New_York', true],
    ['Asia/Tokyo', false],
  ])(
    'highlights the zone %s only when it is not local',
    (timeZone, isLocal) => {
      mockOverride = { timeZone: timeZone ?? null, setTimeZone: jest.fn() };
      mockDisplayTimeZone = timeZone;
      renderPicker();

      const badge = screen.getByTestId('time-picker-time-zone');
      expect(badge).toHaveAttribute('data-local', String(isLocal));
    },
  );

  async function pickTimeZone(option: RegExp) {
    fireEvent.click(screen.getByTestId('time-picker-input'));
    await userEvent.click(
      await screen.findByTestId('time-picker-time-zone-select'),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: option, hidden: true }),
    );
  }

  it('sets the page override', async () => {
    const setTimeZone = jest.fn();
    mockOverride = { timeZone: null, setTimeZone };
    renderPicker();

    await pickTimeZone(/^UTC/);

    expect(setTimeZone).toHaveBeenCalledWith('Etc/UTC');
  });

  it.each([
    ['time-picker-time-zone-utc', 'Etc/UTC'],
    ['time-picker-time-zone-local', 'local'],
  ])('sets the override from the %s shortcut', async (testId, timeZone) => {
    const setTimeZone = jest.fn();
    mockOverride = { timeZone: 'Asia/Tokyo', setTimeZone };
    renderPicker();
    fireEvent.click(screen.getByTestId('time-picker-input'));

    await userEvent.click(await screen.findByTestId(testId));

    expect(setTimeZone).toHaveBeenCalledWith(timeZone);
  });

  it('clears the page override with the Default shortcut', async () => {
    const setTimeZone = jest.fn();
    mockOverride = { timeZone: 'Asia/Tokyo', setTimeZone };
    renderPicker();
    fireEvent.click(screen.getByTestId('time-picker-input'));

    const shortcuts = (
      await screen.findByTestId('time-picker-time-zone-default')
    ).parentElement;
    expect(
      Array.from(shortcuts?.children ?? []).map(button => button.textContent),
    ).toEqual(['Default', 'UTC', 'Local']);

    await userEvent.click(screen.getByTestId('time-picker-time-zone-default'));

    expect(setTimeZone).toHaveBeenCalledWith(null);
  });

  it('clears the page override with the default option', async () => {
    const setTimeZone = jest.fn();
    mockOverride = { timeZone: 'Etc/UTC', setTimeZone };
    mockDisplayTimeZone = 'Etc/UTC';
    renderPicker();

    // The default names the user setting, which is unset here.
    await pickTimeZone(/^Default \(Local\)/);

    expect(setTimeZone).toHaveBeenCalledWith(null);
  });
});
