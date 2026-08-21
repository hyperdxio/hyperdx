import { screen } from '@testing-library/react';

import { ChartCard } from '@/components/charts/ChartCard';
import ChartContainer from '@/components/charts/ChartContainer';

// The header row (the Group wrapping the title) gets a bottom border only in
// "card mode", which ChartCard turns on via its context provider.
function headerRowFor(title: string): HTMLElement {
  const headerRow = screen.getByText(title).parentElement;
  if (headerRow == null) {
    throw new Error(`Expected a parent element for "${title}"`);
  }
  return headerRow;
}

describe('ChartCard', () => {
  it('puts a nested titled ChartContainer into card mode so it draws the divider', () => {
    renderWithMantine(
      <ChartCard>
        <ChartContainer title="Throughput">
          <div>chart</div>
        </ChartContainer>
      </ChartCard>,
    );

    expect(headerRowFor('Throughput').style.borderBottom).toBe(
      '1px solid var(--color-border)',
    );
  });

  it('keeps the card-mode header pinned (fixed + sticky) while the body scrolls', () => {
    renderWithMantine(
      <ChartCard>
        <ChartContainer title="Throughput">
          <div>chart</div>
        </ChartContainer>
      </ChartCard>,
    );

    const header = headerRowFor('Throughput');
    // The header never shrinks or scrolls with the body...
    expect(header.style.flexShrink).toBe('0');
    // ...and stays put if the card itself is the scroll container.
    expect(header.style.position).toBe('sticky');
    expect(header.style.top).toBe('0px');
  });

  it('reserves a uniform header height whether or not the header has controls', () => {
    renderWithMantine(
      <>
        <ChartCard>
          <ChartContainer title="No controls">
            <div>chart</div>
          </ChartContainer>
        </ChartCard>
        <ChartCard>
          <ChartContainer
            title="With controls"
            toolbarItems={[<span key="a" />]}
          >
            <div>chart</div>
          </ChartContainer>
        </ChartCard>
      </>,
    );

    // Both card headers reserve the same min height so titles/dividers align
    // across tiles regardless of whether the header carries a control.
    expect(headerRowFor('No controls').style.minHeight).toBe('43px');
    expect(headerRowFor('With controls').style.minHeight).toBe('43px');
  });

  it('gives scrollable (disableReactiveContainer) card content its own scroll region', () => {
    renderWithMantine(
      <ChartCard>
        <ChartContainer title="Queries" disableReactiveContainer>
          <div data-testid="list-body">list</div>
        </ChartContainer>
      </ChartCard>,
    );

    const scrollRegion = screen.getByTestId('list-body').parentElement;
    if (scrollRegion == null) {
      throw new Error('Expected a scroll region wrapping the card body');
    }
    // The body owns the scroll so the fixed header stays pinned above a long,
    // normal-flow list (e.g. "Top 20 Most Time Consuming Queries").
    expect(scrollRegion.style.overflow).toBe('auto');
    expect(scrollRegion.style.flexGrow).toBe('1');
    expect(scrollRegion.style.minHeight).toBe('0');
  });

  it('does not wrap standalone (non-card) disableReactiveContainer content in a scroll region', () => {
    renderWithMantine(
      <ChartContainer title="Queries" disableReactiveContainer>
        <div data-testid="list-body">list</div>
      </ChartContainer>,
    );

    const parent = screen.getByTestId('list-body').parentElement;
    if (parent == null) {
      throw new Error('Expected a parent element for the body');
    }
    expect(parent.style.overflow).toBe('');
  });

  it('leaves a standalone ChartContainer header plain (not sticky, no divider)', () => {
    renderWithMantine(
      <ChartContainer title="Throughput">
        <div>chart</div>
      </ChartContainer>,
    );

    expect(headerRowFor('Throughput').style.position).toBe('');
  });

  it('leaves a standalone ChartContainer header plain (no divider)', () => {
    renderWithMantine(
      <ChartContainer title="Throughput">
        <div>chart</div>
      </ChartContainer>,
    );

    expect(headerRowFor('Throughput').style.borderBottom).toBe('');
  });

  it('merges a caller style over the card defaults', () => {
    renderWithMantine(
      <ChartCard style={{ height: 321 }} data-testid="card">
        <div>chart</div>
      </ChartCard>,
    );

    expect(screen.getByTestId('card').style.height).toBe('321px');
  });

  it('re-applies the divider padding invariant even if a caller overrides it', () => {
    renderWithMantine(
      <ChartCard style={{ paddingInline: 999 }} data-testid="card">
        <div>chart</div>
      </ChartCard>,
    );

    // paddingInline is pinned to the tile inset regardless of caller style so
    // the full-bleed header divider stays aligned with the card edges.
    expect(screen.getByTestId('card').style.paddingInline).not.toBe('999px');
  });
});
