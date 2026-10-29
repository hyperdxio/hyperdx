import { screen } from '@testing-library/react';

import { ColorLegend } from '@/components/DBHeatmapChart/ColorLegend';

describe('ColorLegend', () => {
  it('renders one swatch per palette color between the low and high labels', () => {
    renderWithMantine(<ColorLegend colors={['#111', '#222', '#333']} />);

    const legend = screen.getByRole('img', {
      name: 'Color scale: low to high count',
    });
    expect(legend).toHaveTextContent(/^Low.*High$/);
    expect(legend.querySelectorAll('div[style*="background"]')).toHaveLength(3);
  });
});
