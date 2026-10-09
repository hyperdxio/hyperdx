import React from 'react';

import {
  highlightTerms,
  QUERY_HIGHLIGHT_BACKGROUND,
} from '@/components/DBTable/highlightText';
import LogLevel from '@/components/LogLevel';

describe('LogLevel', () => {
  it('renders the level when given no children', () => {
    const { container } = renderWithMantine(<LogLevel level="error" />);
    expect(container).toHaveTextContent('error');
  });

  it('renders children instead of the bare level', () => {
    const { container } = renderWithMantine(
      <LogLevel level="error">
        {highlightTerms('error', [
          {
            terms: ['err'],
            backgroundColor: QUERY_HIGHLIGHT_BACKGROUND,
          },
        ])}
      </LogLevel>,
    );

    expect(container).toHaveTextContent('error');
    const mark = container.querySelector('mark');
    expect(mark).toHaveTextContent('err');
    expect(mark).toHaveStyle({ backgroundColor: QUERY_HIGHLIGHT_BACKGROUND });
  });

  // The wash is translucent, so leaving the color unset is what keeps a
  // highlighted level reading as its own severity rather than body text.
  it('leaves a highlighted level its severity color', () => {
    const { container } = renderWithMantine(
      <LogLevel level="error">
        {highlightTerms('error', [
          {
            terms: ['error'],
            backgroundColor: QUERY_HIGHLIGHT_BACKGROUND,
          },
        ])}
      </LogLevel>,
    );

    expect(container.querySelector('mark')?.style.color).toBe('inherit');
  });
});
