import React from 'react';

import {
  highlightTerms,
  QUERY_HIGHLIGHT,
} from '@/components/DBTable/highlightText';
import LogLevel from '@/components/LogLevel';

describe('LogLevel', () => {
  it('renders the level when given no children', () => {
    const { container } = renderWithMantine(<LogLevel level="error" />);
    expect(container).toHaveTextContent('error');
  });

  // The wash is translucent and sets no colour, so a highlighted level still
  // reads as its own severity rather than as body text.
  it('renders highlighted children, leaving them the severity colour', () => {
    const { container } = renderWithMantine(
      <LogLevel level="error">
        {highlightTerms('error', [{ ...QUERY_HIGHLIGHT, terms: ['err'] }])}
      </LogLevel>,
    );

    expect(container).toHaveTextContent('error');
    expect(container.querySelector('mark')).toHaveStyle({
      backgroundColor: QUERY_HIGHLIGHT.backgroundColor,
      color: 'inherit',
    });
  });
});
