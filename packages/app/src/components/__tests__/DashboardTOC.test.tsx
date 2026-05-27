import * as React from 'react';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DashboardTOC } from '@/components/DashboardTOC';

// jsdom does not ship an IntersectionObserver implementation. Provide a tiny
// fake that records the most recent observer instance and exposes a manual
// `trigger` so tests can simulate intersection-ratio updates and assert the
// resulting active-state changes.
type Entry = { id: string; intersectionRatio: number };
type FakeObserver = {
  callback: IntersectionObserverCallback;
  observed: Set<Element>;
  trigger: (entries: Entry[]) => void;
};
let lastObserver: FakeObserver | null = null;

beforeEach(() => {
  lastObserver = null;
  class IO {
    constructor(public callback: IntersectionObserverCallback) {
      const observed = new Set<Element>();
      const self: FakeObserver = {
        callback,
        observed,
        trigger: entries => {
          const ioEntries = entries.map(e => {
            const target = document.getElementById(`container-${e.id}`)!;
            return {
              target,
              intersectionRatio: e.intersectionRatio,
              isIntersecting: e.intersectionRatio > 0,
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(),
              rootBounds: null,
              time: 0,
            } as unknown as IntersectionObserverEntry;
          });
          act(() => {
            callback(ioEntries, this as unknown as IntersectionObserver);
          });
        },
      };
      Object.assign(this, self);
      lastObserver = self;
    }
    observe(el: Element) {
      (this as unknown as FakeObserver).observed.add(el);
    }
    unobserve(el: Element) {
      (this as unknown as FakeObserver).observed.delete(el);
    }
    disconnect() {
      (this as unknown as FakeObserver).observed.clear();
    }
    takeRecords() {
      return [];
    }
  }
  (
    globalThis as unknown as {
      IntersectionObserver: typeof IntersectionObserver;
    }
  ).IntersectionObserver = IO as unknown as typeof IntersectionObserver;
});

// The component scopes IntersectionObserver to #app-content-scroll-container.
// We mount that element + a target element per container so observer.observe
// has something to attach to.
function mountDomFixtures(ids: string[]) {
  const root = document.createElement('div');
  root.id = 'app-content-scroll-container';
  document.body.appendChild(root);
  for (const id of ids) {
    const el = document.createElement('div');
    el.id = `container-${id}`;
    root.appendChild(el);
  }
  return () => {
    document.body.removeChild(root);
  };
}

function renderTOC(
  props: Partial<React.ComponentProps<typeof DashboardTOC>> = {},
) {
  const defaults: React.ComponentProps<typeof DashboardTOC> = {
    containers: [
      { id: 'a', title: 'Latency' },
      { id: 'b', title: 'Errors' },
      { id: 'c', title: 'Throughput' },
    ],
    onJump: jest.fn(),
    ...props,
  };
  return render(
    <MantineProvider>
      <DashboardTOC {...defaults} />
    </MantineProvider>,
  );
}

describe('DashboardTOC', () => {
  it('renders one entry per container', () => {
    const cleanup = mountDomFixtures(['a', 'b', 'c']);
    renderTOC();
    expect(screen.getByTestId('toc-entry-a')).toBeInTheDocument();
    expect(screen.getByTestId('toc-entry-b')).toBeInTheDocument();
    expect(screen.getByTestId('toc-entry-c')).toBeInTheDocument();
    cleanup();
  });

  it('shows container titles as the entry labels', () => {
    const cleanup = mountDomFixtures(['a', 'b', 'c']);
    renderTOC();
    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
    cleanup();
  });

  it('falls back to "(untitled)" for entries with an empty title', () => {
    const cleanup = mountDomFixtures(['x']);
    renderTOC({ containers: [{ id: 'x', title: '' }] });
    expect(screen.getByText('(untitled)')).toBeInTheDocument();
    cleanup();
  });

  it('invokes onJump with the clicked container id', () => {
    const cleanup = mountDomFixtures(['a', 'b', 'c']);
    const onJump = jest.fn();
    renderTOC({ onJump });
    fireEvent.click(screen.getByTestId('toc-entry-b'));
    expect(onJump).toHaveBeenCalledWith('b');
    cleanup();
  });

  it('renders nothing when there are no containers', () => {
    const { container } = renderTOC({ containers: [] });
    expect(container.querySelector('[data-testid="dashboard-toc"]')).toBeNull();
  });

  it('marks the most-visible entry as active', () => {
    const cleanup = mountDomFixtures(['a', 'b', 'c']);
    renderTOC();
    // Initially no observer reports → no entry is active.
    expect(screen.getByTestId('toc-entry-a')).not.toHaveAttribute(
      'data-active',
    );

    // Simulate scrolling so that container B has the highest intersection
    // ratio. B should become the active entry; A and C should not be active.
    lastObserver!.trigger([
      { id: 'a', intersectionRatio: 0.2 },
      { id: 'b', intersectionRatio: 0.9 },
      { id: 'c', intersectionRatio: 0.1 },
    ]);
    expect(screen.getByTestId('toc-entry-b')).toHaveAttribute('data-active');
    expect(screen.getByTestId('toc-entry-a')).not.toHaveAttribute(
      'data-active',
    );
    expect(screen.getByTestId('toc-entry-c')).not.toHaveAttribute(
      'data-active',
    );

    // Now simulate scrolling so C is most visible — active moves to C.
    lastObserver!.trigger([
      { id: 'a', intersectionRatio: 0 },
      { id: 'b', intersectionRatio: 0.3 },
      { id: 'c', intersectionRatio: 0.8 },
    ]);
    expect(screen.getByTestId('toc-entry-c')).toHaveAttribute('data-active');
    expect(screen.getByTestId('toc-entry-b')).not.toHaveAttribute(
      'data-active',
    );

    cleanup();
  });
});
