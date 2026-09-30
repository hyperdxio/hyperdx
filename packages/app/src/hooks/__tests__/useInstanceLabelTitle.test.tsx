import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'UK' }));

import { useInstanceLabelTitle } from '@/hooks/useInstanceLabelTitle';

describe('useInstanceLabelTitle', () => {
  beforeEach(() => {
    document.title = 'Search - HyperDX';
  });

  it('appends the instance label to the current title', () => {
    renderHook(() => useInstanceLabelTitle());
    expect(document.title).toBe('Search - HyperDX UK');
  });

  it('keeps appending the label as the title changes on navigation', done => {
    renderHook(() => useInstanceLabelTitle());
    document.title = 'Alerts - HyperDX';
    // MutationObserver callbacks are microtasks; flush before asserting.
    queueMicrotask(() => {
      expect(document.title).toBe('Alerts - HyperDX UK');
      done();
    });
  });

  it('does not double-append if the title already has the suffix', () => {
    document.title = 'Search - HyperDX UK';
    renderHook(() => useInstanceLabelTitle());
    expect(document.title).toBe('Search - HyperDX UK');
  });
});
