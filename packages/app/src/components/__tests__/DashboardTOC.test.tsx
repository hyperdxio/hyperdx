import * as React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { DashboardTOC } from '@/components/DashboardTOC';

// `useScrollSpy` reaches into the DOM and attaches scroll listeners. None of
// that is interesting at unit-test scope — what we care about is the list
// renders correctly, click hands the right id back, and empty input renders
// nothing. Mock it to a quiet stub.
jest.mock('@mantine/hooks', () => {
  const actual = jest.requireActual('@mantine/hooks');
  return {
    ...actual,
    useScrollSpy: () => ({
      active: 0,
      data: [],
      initialized: true,
      reinitialize: jest.fn(),
    }),
  };
});

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
    renderTOC();
    expect(screen.getByTestId('toc-entry-a')).toBeInTheDocument();
    expect(screen.getByTestId('toc-entry-b')).toBeInTheDocument();
    expect(screen.getByTestId('toc-entry-c')).toBeInTheDocument();
  });

  it('shows container titles as the entry labels', () => {
    renderTOC();
    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
  });

  it('falls back to "(untitled)" for entries with an empty title', () => {
    renderTOC({
      containers: [{ id: 'x', title: '' }],
    });
    expect(screen.getByText('(untitled)')).toBeInTheDocument();
  });

  it('invokes onJump with the clicked container id', () => {
    const onJump = jest.fn();
    renderTOC({ onJump });
    fireEvent.click(screen.getByTestId('toc-entry-b'));
    expect(onJump).toHaveBeenCalledWith('b');
  });

  it('renders nothing when there are no containers', () => {
    const { container } = renderTOC({ containers: [] });
    expect(container.querySelector('[data-testid="dashboard-toc"]')).toBeNull();
  });

  it('marks only the scrollspy-active entry with data-active', () => {
    // The mock fixes `active: 0`, so the first container ('a') should be the
    // sole entry with `data-active`. This locks in the contract used by the
    // visual styling (border + text color).
    renderTOC();
    expect(screen.getByTestId('toc-entry-a')).toHaveAttribute('data-active');
    expect(screen.getByTestId('toc-entry-b')).not.toHaveAttribute(
      'data-active',
    );
    expect(screen.getByTestId('toc-entry-c')).not.toHaveAttribute(
      'data-active',
    );
  });
});
