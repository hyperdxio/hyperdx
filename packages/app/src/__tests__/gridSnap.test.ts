import {
  computeSnapCells,
  computeSnapColWidth,
} from '@/components/dashboard/gridSnap';

// Geometry chosen so column/row math is exact:
//   width 590, cols 12, marginX 10  -> colWidth 40, colPitch 50
//   rowHeight 30, marginY 10        -> rowPitch 40
const BASE = {
  width: 590,
  height: 200,
  cols: 12,
  rowHeight: 30,
  marginX: 10,
  marginY: 10,
  padX: 0,
  padY: 0,
};

describe('computeSnapColWidth', () => {
  it('splits the usable width across columns like react-grid-layout', () => {
    expect(computeSnapColWidth(590, 12, 10, 0)).toBe(40);
    // Container padding is subtracted from both sides.
    expect(computeSnapColWidth(600, 12, 10, 5)).toBe(40);
  });

  it('returns 0 when there are no columns', () => {
    expect(computeSnapColWidth(590, 0, 10, 0)).toBe(0);
  });
});

describe('computeSnapCells', () => {
  it('fills one cell per column for every fully visible row', () => {
    // rows: padY + row*40 + 30 <= 200.5  ->  rows 0..4  ->  5 rows
    const cells = computeSnapCells(BASE);
    expect(cells).toHaveLength(12 * 5);
  });

  it('aligns a dropped tile: its left and right edges land on cell edges', () => {
    const cells = computeSnapCells(BASE);
    const colWidth = 40;
    const colPitch = 50;
    const tile = { x: 2, w: 3 };
    // react-grid-layout tile pixel bounds.
    const tileLeft = colPitch * tile.x;
    const tileRight =
      tileLeft + tile.w * colWidth + (tile.w - 1) * BASE.marginX;

    const leftCell = cells.find(c => c.x === tileLeft);
    const rightCell = cells.find(c => c.x + colWidth === tileRight);
    expect(leftCell).toBeDefined();
    expect(rightCell).toBeDefined();
    // The right edge lands on the last spanned column, not one margin short.
    expect(rightCell?.x).toBe(colPitch * (tile.x + tile.w - 1));
  });

  it('flags cells within one cell of the focus footprint as neighbors', () => {
    const focus = { x: 2, y: 1, w: 3, h: 2 };
    const cells = computeSnapCells({ ...BASE, focus });
    const colPitch = 50;
    const rowPitch = 40;
    const near = (col: number, row: number) =>
      cells.find(c => c.x === col * colPitch && c.y === row * rowPitch)?.near;

    // Footprint cols 2..4, rows 1..2; radius 1 -> cols 1..5, rows 0..3.
    expect(near(1, 0)).toBe(true); // top-left neighbor
    expect(near(5, 3)).toBe(true); // bottom-right neighbor
    expect(near(3, 1)).toBe(true); // inside the footprint
    expect(near(0, 0)).toBe(false); // one column too far left
    expect(near(6, 1)).toBe(false); // one column too far right
    expect(near(3, 4)).toBe(false); // one row too far down
  });

  it('marks nothing as a neighbor without a focus', () => {
    const cells = computeSnapCells({ ...BASE, focus: null });
    expect(cells.every(c => !c.near)).toBe(true);
  });

  it('returns no cells before the container has been measured', () => {
    expect(computeSnapCells({ ...BASE, width: 0, height: 0 })).toEqual([]);
  });
});
