import { screen } from '@testing-library/react';

import LogLevel from '@/components/LogLevel';

describe('LogLevel', () => {
  it.each([
    ['info', '17', 'ERROR (info)'],
    [null, 18, 'ERROR2'],
    ['error', 0, 'error'],
  ])(
    'labels text %p with number %p as %p in red',
    (level, severityNumber, label) => {
      renderWithMantine(
        <LogLevel level={level} severityNumber={severityNumber} />,
      );

      expect(screen.getByText(label).getAttribute('style')).toContain('red');
    },
  );

  it.each([0, undefined])(
    'renders nothing without text or a valid number (%p)',
    severityNumber => {
      const { container } = renderWithMantine(
        <LogLevel level="" severityNumber={severityNumber} />,
      );

      expect(container.querySelector('.mantine-Text-root')).toBeNull();
    },
  );
});
