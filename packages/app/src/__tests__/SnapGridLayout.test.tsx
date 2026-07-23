import { fireEvent, render, screen } from '@testing-library/react';

import SnapGridLayout from '@/components/dashboard/SnapGridLayout';

// Fixtures the mocked grid fires into the drag/resize callbacks. Prefixed with
// `mock` so jest allows referencing them from the (hoisted) mock factory.
const mockOld = { i: 'a', x: 0, y: 0, w: 3, h: 2 };
const mockNewStart = { i: 'a', x: 2, y: 1, w: 3, h: 2 };
const mockNewMove = { i: 'a', x: 5, y: 3, w: 3, h: 2 };
const mockLayout = [mockOld];

// Replace react-grid-layout with a stub that renders buttons to fire each
// lifecycle callback with realistic arguments, so we can drive the wrapper's
// logic without a real drag.
jest.mock('react-grid-layout', () => {
  const React = jest.requireActual('react');
  const fire = (handler: any, item: any) => () =>
    handler?.(mockLayout, mockOld, item, item, {}, {});
  const GridLayout = (props: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'rgl' },
      React.createElement('button', {
        'data-testid': 'dragstart',
        onClick: fire(props.onDragStart, mockNewStart),
      }),
      React.createElement('button', {
        'data-testid': 'drag',
        onClick: fire(props.onDrag, mockNewMove),
      }),
      React.createElement('button', {
        'data-testid': 'dragstop',
        onClick: fire(props.onDragStop, mockNewMove),
      }),
      React.createElement('button', {
        'data-testid': 'resizestart',
        onClick: fire(props.onResizeStart, mockNewStart),
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

describe('SnapGridLayout', () => {
  it('hides the overlay until a drag starts, then shows the tile position', () => {
    const onDragStart = jest.fn();
    render(
      <SnapGridLayout onDragStart={onDragStart}>
        <div key="a" />
      </SnapGridLayout>,
    );

    expect(screen.queryByTestId('overlay')).toBeNull();

    fireEvent.click(screen.getByTestId('dragstart'));

    const overlay = screen.getByTestId('overlay');
    expect(JSON.parse(overlay.getAttribute('data-focus') ?? 'null')).toEqual({
      x: 2,
      y: 1,
      w: 3,
      h: 2,
    });
    // The caller's handler still fires with its original arguments.
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart.mock.calls[0][2]).toEqual(mockNewStart);
  });

  it('tracks the moving tile and clears the overlay on drop', () => {
    const onDrag = jest.fn();
    const onDragStop = jest.fn();
    render(
      <SnapGridLayout onDrag={onDrag} onDragStop={onDragStop}>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('dragstart'));
    fireEvent.click(screen.getByTestId('drag'));

    expect(
      JSON.parse(
        screen.getByTestId('overlay').getAttribute('data-focus') ?? 'null',
      ),
    ).toEqual({ x: 5, y: 3, w: 3, h: 2 });
    expect(onDrag).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('dragstop'));

    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(onDragStop).toHaveBeenCalledTimes(1);
  });

  it('shows the overlay while resizing too', () => {
    const onResizeStart = jest.fn();
    render(
      <SnapGridLayout onResizeStart={onResizeStart}>
        <div key="a" />
      </SnapGridLayout>,
    );

    fireEvent.click(screen.getByTestId('resizestart'));

    expect(screen.getByTestId('overlay')).toBeInTheDocument();
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });
});
