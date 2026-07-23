import { render } from '@testing-library/react';

import GridSnapOverlay from '@/components/dashboard/GridSnapOverlay';

// jsdom has no layout, so clientWidth/clientHeight are 0 and the overlay would
// render nothing. Feed a fixed size so the geometry (12 cols, rowHeight 30,
// default margin [10,10]) resolves to colWidth 40 and 5 fully visible rows.
describe('GridSnapOverlay', () => {
  let widthSpy: jest.SpyInstance;
  let heightSpy: jest.SpyInstance;

  beforeAll(() => {
    widthSpy = jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(590);
    heightSpy = jest
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(200);
  });

  afterAll(() => {
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it('renders one rect per snap cell once measured', () => {
    const { container } = render(<GridSnapOverlay cols={12} rowHeight={30} />);
    // 12 columns x 5 rows.
    expect(container.querySelectorAll('rect')).toHaveLength(60);
  });

  it('gives cells around the focus the near class and the rest the base class', () => {
    const { container } = render(
      <GridSnapOverlay
        cols={12}
        rowHeight={30}
        focus={{ x: 2, y: 1, w: 3, h: 2 }}
      />,
    );
    // Footprint cols 2..4, rows 1..2; radius 1 -> cols 1..5 x rows 0..3 = 20.
    expect(container.querySelectorAll('.gridCellNear')).toHaveLength(20);
    expect(container.querySelectorAll('.gridCell')).toHaveLength(40);
  });
});
