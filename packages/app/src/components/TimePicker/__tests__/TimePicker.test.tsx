import { fireEvent, screen } from '@testing-library/react';

import { TimePicker } from '@/components/TimePicker';

let mockTimeZone: string | undefined;
jest.mock('@/useDisplayTimeZone', () => ({
  useDisplayTimeZone: () => mockTimeZone,
}));

// Tests run with TZ=America/New_York, behind UTC, where a UTC range ending
// now used to be read as local time, land in the future, and get clamped.
describe('TimePicker time zone', () => {
  const LAST_HOUR_UTC = 'Oct 22 14:00:00 - Oct 22 15:00:00';

  beforeEach(() => {
    // Only fake the clock: Mantine's popover relies on real timers.
    jest.useFakeTimers({
      now: new Date('2026-10-22T15:00:00Z'),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'queueMicrotask',
        'nextTick',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderPicker(timeZone: string | undefined, inputValue: string) {
    mockTimeZone = timeZone;
    const onSearch = jest.fn();
    renderWithMantine(
      <TimePicker
        inputValue={inputValue}
        setInputValue={jest.fn()}
        onSearch={onSearch}
      />,
    );
    fireEvent.click(screen.getByTestId('time-picker-input'));
    return { onSearch };
  }

  it('shows and applies the range in the display time zone', async () => {
    const { onSearch } = renderPicker('Etc/UTC', LAST_HOUR_UTC);

    expect(
      await screen.findAllByDisplayValue('2026-10-22 14:00:00'),
    ).not.toHaveLength(0);
    expect(screen.getAllByDisplayValue('2026-10-22 15:00:00')).not.toHaveLength(
      0,
    );

    fireEvent.click(screen.getByTestId('time-picker-apply'));
    expect(onSearch).toHaveBeenCalledWith(
      'Oct 22 2:00:00 PM - Oct 22 3:00:00 PM',
    );
  });

  it('shows the range in the local zone without a display time zone', async () => {
    renderPicker(undefined, 'Oct 22 10:00:00 - Oct 22 11:00:00');

    expect(
      await screen.findAllByDisplayValue('2026-10-22 10:00:00'),
    ).not.toHaveLength(0);
    expect(screen.getAllByDisplayValue('2026-10-22 11:00:00')).not.toHaveLength(
      0,
    );
  });
});
