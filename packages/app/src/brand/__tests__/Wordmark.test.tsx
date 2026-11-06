import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import { useLogomark, useWordmark } from '@/brand';

function Lockup() {
  return useWordmark();
}

function SquareMark() {
  return useLogomark({ size: 22 });
}

describe('Wordmark', () => {
  it('renders the brand name beside a mark that hugs the hexagon', () => {
    const { container } = render(
      <MantineProvider>
        <Lockup />
      </MantineProvider>,
    );

    expect(screen.getByText('ClickStack')).toBeInTheDocument();
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('height', '23');
    expect(Number(svg?.getAttribute('width'))).toBeLessThan(23);
  });
});

describe('Logomark', () => {
  it('keeps a square box unless the wordmark asks it to hug the symbol', () => {
    const { container } = render(<SquareMark />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg).toHaveAttribute('height', '22');
  });
});
