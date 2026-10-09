import React from 'react';
import { render } from '@testing-library/react';

import {
  FIND_HIGHLIGHT,
  highlightTerms,
  QUERY_HIGHLIGHT,
} from '@/components/DBTable/highlightText';

const find = (terms: string[]) => ({ ...FIND_HIGHLIGHT, terms });
const query = (terms: string[]) => ({ ...QUERY_HIGHLIGHT, terms });

const marks = (node: React.ReactNode) => {
  const { container } = render(<span>{node}</span>);
  return Array.from(container.querySelectorAll('mark'));
};

describe('highlightTerms', () => {
  it('returns the plain string when nothing matches', () => {
    expect(highlightTerms('checkout failed', [query(['timeout'])])).toBe(
      'checkout failed',
    );
    expect(highlightTerms('checkout failed', [])).toBe('checkout failed');
    expect(highlightTerms('checkout failed', [query(['  '])])).toBe(
      'checkout failed',
    );
  });

  it('highlights every occurrence of every term, keeping the original casing', () => {
    const found = marks(
      highlightTerms('Checkout failed: checkout timeout', [
        query(['checkout', 'timeout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual([
      'Checkout',
      'checkout',
      'timeout',
    ]);
  });

  it('styles each term by its group', () => {
    const found = marks(
      highlightTerms('checkout timeout', [
        find(['timeout']),
        query(['checkout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual(['checkout', 'timeout']);
    expect(found[0]).toHaveStyle({
      backgroundColor: QUERY_HIGHLIGHT.backgroundColor,
      // unset, so a log level keeps its severity colour under the wash
      color: 'inherit',
    });
    expect(found[1]).toHaveStyle({
      backgroundColor: FIND_HIGHLIGHT.backgroundColor,
      color: FIND_HIGHLIGHT.textColor,
    });
  });

  it('lets the earlier group win when matches overlap', () => {
    const found = marks(
      highlightTerms('connection timeout', [
        find(['tion tim']),
        query(['connection', 'timeout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual(['tion tim']);
    expect(found[0]).toHaveStyle({
      backgroundColor: FIND_HIGHLIGHT.backgroundColor,
    });
  });

  it('keeps non-overlapping matches from a later group', () => {
    const found = marks(
      highlightTerms('checkout connection timeout', [
        find(['connection']),
        query(['checkout', 'timeout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual([
      'checkout',
      'connection',
      'timeout',
    ]);
  });

  it('prefers the longest match when terms in one group overlap', () => {
    const found = marks(
      highlightTerms('connection refused', [query(['conn', 'connection'])]),
    );
    expect(found.map(m => m.textContent)).toEqual(['connection']);
  });

  it('preserves the surrounding text', () => {
    const { container } = render(
      <span>{highlightTerms('GET /health 500', [query(['/health'])])}</span>,
    );
    expect(container).toHaveTextContent('GET /health 500');
  });
});
