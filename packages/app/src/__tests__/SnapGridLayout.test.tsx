import { act, fireEvent, render, screen } from '@testing-library/react';

import SnapGridLayout from '@/components/dashboard/SnapGridLayout';

// Fixtures the mocked grid fires into the drag/resize callbacks. Prefixed with
// `mock` so jest allows referencing them from the (hoisted) mock factory.
const mockOld = { i: 'a', x: 0, y: 0, w: 3, h: 2 };
// The raw cursor position react-grid-layout reports as `newItem`.
const mockCursor = { i: 'a', x: 5, y: 3, w: 3, h: 2 };
// The compacted drop position react-grid-layout reports as the `placeholder`
// (4th arg). Distinct y from the cursor so we can prove the overlay follows the
// landing spot, not the cursor.
const mockLanding = { i: 'a', x: 5, y: 0, w: 3, h: 2 };
const mockLayout = [mockOld];

// Replace react-grid-layout with a stub that renders buttons to fire each
// lifecycle callback with realistic arguments (newItem = cursor, placeholder =
// landing), so we can drive the wrapper's logic without a real drag.
jest.mock('react-grid-layout', () => {
  const React = jest.requireActual('react');
  const fire = (handler: any, newItem: any, placeholder: any) => () =>
    handler?.(mockLayout, mockOld, newItem, placeholder, {}, {});
  const GridLayout = (props: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'rgl' },
      React.createElement('button', {
        'data-testid': 'dragstart',
        onClick: fire(props.onDragStart, mockCursor, mockCursor),
      }),
      React.createElement('button', {
        'data-testid': 'drag',
        onClick: fire(props.onDrag, mockCursor, mockLanding),
      }),
      React.createElement('button', {
        'data-testid': 'dragstop',
        onClick: fire(props.onDragStop, mockCursor, mockLanding),
      }),
      React.createElement('button', {
        'data-testid': 'resizestart',
        onClick: fire(props.onResizeStart, mockCursor, mockCursor),
      }),
      React.createElement('button', {
        'data-testid': 'resize',
        onClick: fire(props.onResize, mockCursor, mockLanding),
      }),
      props.children,
    );
  return {
    __esModule: true,
    default: GridLayout,
    WidthProvider: (c: any) => c,
  };
});

// Stub the overlay so we can read the focus it receives and its presence.
jest.mock('@/components/dashboard/GridSnapOverlay', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement('div', {
        'data-testid': 'overlay',
        'data-focus': JSON.stringify(props.focus),
      }),
  };
});

const focusOf = () =>
  JSON.parse(
    screen.getByTestId('overlay').getAttribute('data-focus') ?? 'null',
  );

describe('SnapGridLayout', () => {
  it('does not show the overlay on drag start, only once the tile moves', () => {
    render(
      <SnapGridLayout>
        <div key="a" />
      </SnapGridLayout>,
    );

    expect(screen.queryByTestId('overlay')).toBeNull();

    // Start fires on mousedown; the grid must stay hidden until an actual move.
    fireEvent.click(screen.getByTestId('dragstart'));
    expect(screen.queryByTestId('overlay')).toBeNull();

    fireEvent.click(screen.getByTestId('drag'));
    expect(screen.getByTestId('overlay')).toBeInTheDocument();
  });

  it('never shows the overlay for a plain click (start then stop, no move)', () => {
    // Regression: clicking a tile (or a control on it) fired start without a
    // move, which used to leave the grid stuck on.
    render(
      <SnapGridLayout>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('dragstart'));
    fireEvent.click(screen.getByTestId('dragstop'));

    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('highlights where the tile will land (placeholder), not the cursor', () => {
    render(
      <SnapGridLayout>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('drag'));

    // Follows the compacted landing (y:0), not the raw cursor (y:3).
    expect(focusOf()).toEqual({ x: 5, y: 0, w: 3, h: 2 });
  });

  it('tracks the moving tile and clears the overlay on drop', () => {
    const onDrag = jest.fn();
    const onDragStop = jest.fn();
    render(
      <SnapGridLayout onDrag={onDrag} onDragStop={onDragStop}>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('drag'));
    expect(focusOf()).toEqual({ x: 5, y: 0, w: 3, h: 2 });

    fireEvent.click(screen.getByTestId('dragstop'));
    expect(screen.queryByTestId('overlay')).toBeNull();

    // The caller's handler still fires with its original args (cursor +
    // placeholder), untouched by the wrapper.
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag.mock.calls[0][2]).toEqual(mockCursor);
    expect(onDrag.mock.calls[0][3]).toEqual(mockLanding);
    expect(onDragStop).toHaveBeenCalledTimes(1);
  });

  it('clears the overlay on pointer release even without a stop callback', () => {
    // Safety net for when react-grid-layout skips its stop callback (e.g. the
    // pointer is released over a menu that opened mid-drag).
    render(
      <SnapGridLayout>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('drag'));
    expect(screen.getByTestId('overlay')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });

    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('shows the overlay while resizing too, once the resize moves', () => {
    render(
      <SnapGridLayout>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('resizestart'));
    expect(screen.queryByTestId('overlay')).toBeNull();

    fireEvent.click(screen.getByTestId('resize'));
    expect(screen.getByTestId('overlay')).toBeInTheDocument();
  });
});
