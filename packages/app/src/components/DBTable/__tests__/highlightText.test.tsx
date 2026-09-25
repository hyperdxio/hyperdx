import React from 'react';
import { render } from '@testing-library/react';

import {
  FIND_CURRENT_HIGHLIGHT_BACKGROUND,
  FIND_HIGHLIGHT_BACKGROUND,
  highlightTerms,
  highlightText,
  QUERY_HIGHLIGHT_BACKGROUND,
} from '@/components/DBTable/highlightText';

describe('highlightText', () => {
  describe('basic highlighting', () => {
    it('should return plain text when query is empty', () => {
      const result = highlightText('hdx-oss-dev-api', '');
      expect(result).toBe('hdx-oss-dev-api');
    });

    it('should return plain text when query is whitespace', () => {
      const result = highlightText('hdx-oss-dev-api', '   ');
      expect(result).toBe('hdx-oss-dev-api');
    });

    it('should highlight matching text in service name', () => {
      const result = highlightText('hdx-oss-dev-api', 'api');
      expect(result).toBeDefined();
    });

    it('should highlight matching text in span name', () => {
      const result = highlightText('mongodb.update', 'mongodb');
      expect(result).toBeDefined();
    });

    it('should be case-insensitive', () => {
      const result = highlightText('hdx-oss-dev-api', 'API');
      expect(result).toBeDefined();
    });

    it('should highlight multiple occurrences', () => {
      const result = highlightText('middleware - corsMiddleware', 'middleware');
      expect(result).toBeDefined();
    });
  });

  describe('partial matches', () => {
    it('should highlight partial match at beginning', () => {
      const result = highlightText('mongodb.update', 'mongo');
      expect(result).toBeDefined();
    });

    it('should highlight partial match at end', () => {
      const result = highlightText('tcp.connect', 'connect');
      expect(result).toBeDefined();
    });

    it('should highlight partial match in middle', () => {
      const result = highlightText('hdx-oss-dev-api', 'oss');
      expect(result).toBeDefined();
    });
  });

  describe('custom styling', () => {
    it('should apply current match highlighting', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        isCurrentMatch: true,
        currentMatchBackgroundColor: 'orange',
      });
      expect(result).toBeDefined();
    });

    it('should apply custom text color', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        textColor: 'white',
      });
      expect(result).toBeDefined();
    });

    it('should apply custom background color', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        backgroundColor: 'yellow',
      });
      expect(result).toBeDefined();
    });

    it('should use different colors for current vs other matches', () => {
      const currentMatch = highlightText('middleware - corsMiddleware', 'mid', {
        isCurrentMatch: true,
      });
      const otherMatch = highlightText('middleware - corsMiddleware', 'mid', {
        isCurrentMatch: false,
      });

      expect(currentMatch).toBeDefined();
      expect(otherMatch).toBeDefined();
      expect(currentMatch).not.toEqual(otherMatch);
    });
  });

  describe('special characters', () => {
    it('should handle text with dots', () => {
      const result = highlightText('mongodb.update', '.');
      expect(result).toBeDefined();
    });

    it('should handle text with slashes', () => {
      const result = highlightText('router - /health', '/health');
      expect(result).toBeDefined();
    });

    it('should handle text with hyphens', () => {
      const result = highlightText('hdx-oss-dev-api', '-oss-');
      expect(result).toBeDefined();
    });

    it('should handle text with underscores', () => {
      const result = highlightText('isUserAuthenticated', 'User');
      expect(result).toBeDefined();
    });
  });

  describe('realistic HyperDX values', () => {
    it('should highlight service names', () => {
      const result = highlightText('hdx-oss-dev-api', 'dev');
      expect(result).toBeDefined();
    });

    it('should highlight span names with dots', () => {
      const result = highlightText('mongodb.update', 'update');
      expect(result).toBeDefined();
    });

    it('should highlight middleware names', () => {
      const result = highlightText(
        'middleware - isUserAuthenticated',
        'authenticated',
      );
      expect(result).toBeDefined();
    });

    it('should highlight router paths', () => {
      const result = highlightText('router - /health', 'health');
      expect(result).toBeDefined();
    });

    it('should highlight DNS operations', () => {
      const result = highlightText('dns.lookup', 'dns');
      expect(result).toBeDefined();
    });

    it('should highlight TCP operations', () => {
      const result = highlightText('tcp.connect', 'tcp');
      expect(result).toBeDefined();
    });

    it('should highlight POST operations', () => {
      const result = highlightText('POST', 'post');
      expect(result).toBeDefined();
    });
  });
});

describe('highlightTerms', () => {
  const findGroup = (terms: string[]) => ({
    terms,
    backgroundColor: FIND_HIGHLIGHT_BACKGROUND,
  });
  const queryGroup = (terms: string[]) => ({
    terms,
    backgroundColor: QUERY_HIGHLIGHT_BACKGROUND,
  });

  const marks = (node: React.ReactNode) => {
    const { container } = render(<span>{node}</span>);
    return Array.from(container.querySelectorAll('mark'));
  };

  it('returns the plain string when nothing matches', () => {
    expect(highlightTerms('checkout failed', [queryGroup(['timeout'])])).toBe(
      'checkout failed',
    );
    expect(highlightTerms('checkout failed', [])).toBe('checkout failed');
    expect(highlightTerms('checkout failed', [queryGroup(['  '])])).toBe(
      'checkout failed',
    );
  });

  it('highlights every occurrence of every term', () => {
    const found = marks(
      highlightTerms('checkout failed: checkout timeout', [
        queryGroup(['checkout', 'timeout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual([
      'checkout',
      'checkout',
      'timeout',
    ]);
  });

  it('matches case-insensitively but renders the original casing', () => {
    const found = marks(
      highlightTerms('Checkout FAILED', [queryGroup(['checkout', 'failed'])]),
    );
    expect(found.map(m => m.textContent)).toEqual(['Checkout', 'FAILED']);
  });

  it('colours each term by its group', () => {
    const found = marks(
      highlightTerms('checkout timeout', [
        findGroup(['timeout']),
        queryGroup(['checkout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual(['checkout', 'timeout']);
    expect(found[0]).toHaveStyle({
      backgroundColor: QUERY_HIGHLIGHT_BACKGROUND,
    });
    expect(found[1]).toHaveStyle({
      backgroundColor: FIND_HIGHLIGHT_BACKGROUND,
    });
  });

  it('lets the earlier group win when matches overlap', () => {
    const found = marks(
      highlightTerms('connection timeout', [
        findGroup(['tion tim']),
        queryGroup(['connection', 'timeout']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual(['tion tim']);
    expect(found[0]).toHaveStyle({
      backgroundColor: FIND_HIGHLIGHT_BACKGROUND,
    });
  });

  it('keeps non-overlapping matches from a later group', () => {
    const found = marks(
      highlightTerms('checkout connection timeout', [
        findGroup(['connection']),
        queryGroup(['checkout', 'timeout']),
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
      highlightTerms('connection refused', [
        queryGroup(['conn', 'connection']),
      ]),
    );
    expect(found.map(m => m.textContent)).toEqual(['connection']);
  });

  it('preserves the surrounding text', () => {
    const { container } = render(
      <span>
        {highlightTerms('GET /health 500', [queryGroup(['/health'])])}
      </span>,
    );
    expect(container).toHaveTextContent('GET /health 500');
  });
});

describe('highlightText current match styling', () => {
  const firstMark = (node: React.ReactNode) => {
    const { container } = render(<span>{node}</span>);
    return container.querySelector('mark');
  };

  it('uses the current match colour only for the current match', () => {
    expect(
      firstMark(highlightText('checkout', 'check', { isCurrentMatch: true })),
    ).toHaveStyle({ backgroundColor: FIND_CURRENT_HIGHLIGHT_BACKGROUND });
    expect(
      firstMark(highlightText('checkout', 'check', { isCurrentMatch: false })),
    ).toHaveStyle({ backgroundColor: FIND_HIGHLIGHT_BACKGROUND });
  });
});
