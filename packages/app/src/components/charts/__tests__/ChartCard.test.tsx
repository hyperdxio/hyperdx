import { screen } from '@testing-library/react';

import { ChartCard } from '@/components/charts/ChartCard';
import ChartContainer from '@/components/charts/ChartContainer';

// The header row (the Group wrapping the title) gets a bottom border only in
// "card mode", which ChartCard turns on via its context provider.
function headerRowFor(title: string) {
  return screen.getByText(title).parentElement as HTMLElement;
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
