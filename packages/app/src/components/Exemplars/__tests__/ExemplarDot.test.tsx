import React from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import { fireEvent, render } from '@testing-library/react';

import { ExemplarDot } from '@/components/Exemplars/ExemplarDot';

const exemplar: Exemplar = { timestamp: 1000, value: 42, traceId: 'abc' };

/**
 * The dot lives inside the chart's SVG, and the chart puts an onClick on its
 * wrapper to pin a drill-down tooltip. This stands in for that wrapper.
 */
function renderDot(props: Partial<React.ComponentProps<typeof ExemplarDot>>) {
  const onParentClick = jest.fn();
  const { container } = render(
    <svg onClick={onParentClick}>
      <ExemplarDot cx={10} cy={20} exemplar={exemplar} {...props} />
    </svg>,
  );
  // The transparent hit circle is the marker's click target.
  const hitTarget = container.querySelector('circle')!;
  return { onParentClick, hitTarget };
}

describe('ExemplarDot', () => {
  it('reports a click and keeps it from reaching the chart', () => {
    const onSelect = jest.fn();
    const { onParentClick, hitTarget } = renderDot({ onSelect });

    fireEvent.click(hitTarget);

    // Without the stopPropagation this fix adds, the chart's own onClick also
    // fires and opens the drill-down tooltip over the exemplar's menu.
    expect(onSelect).toHaveBeenCalledWith(exemplar, 10, 20);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('swallows the click even with no handler attached', () => {
    const { onParentClick, hitTarget } = renderDot({});

    fireEvent.click(hitTarget);

    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('reports hover enter/leave with the marker position', () => {
    const onHoverStart = jest.fn();
    const onHoverEnd = jest.fn();
    const { hitTarget } = renderDot({ onHoverStart, onHoverEnd });

    fireEvent.mouseEnter(hitTarget.parentElement!);
    fireEvent.mouseLeave(hitTarget.parentElement!);

    expect(onHoverStart).toHaveBeenCalledWith(exemplar, 10, 20);
    expect(onHoverEnd).toHaveBeenCalled();
  });

  it('renders nothing until recharts supplies coordinates', () => {
    const { container } = render(
      <svg>
        <ExemplarDot exemplar={exemplar} />
      </svg>,
    );
    expect(container.querySelector('path')).toBeNull();
  });
});

/**
 * Recharts recomputes cx/cy whenever the scales or the container change, so this
 * marker is the only thing that knows an open card's anchor has gone stale — a
 * zoom, a y-axis rescale and a window resize all move it without changing
 * anything the card's owner can observe.
 */
describe('ExemplarDot position reporting', () => {
  const renderAt = (
    cx: number,
    cy: number,
    props: Partial<React.ComponentProps<typeof ExemplarDot>>,
  ) =>
    render(
      <svg>
        <ExemplarDot cx={cx} cy={cy} exemplar={exemplar} {...props} />
      </svg>,
    );

  it('reports its position when it is the active marker', () => {
    const onPositionChange = jest.fn();
    renderAt(10, 20, { isActive: true, onPositionChange });

    expect(onPositionChange).toHaveBeenCalledWith(10, 20);
  });

  it('reports again when recharts moves it', () => {
    const onPositionChange = jest.fn();
    const { rerender } = renderAt(10, 20, {
      isActive: true,
      onPositionChange,
    });
    onPositionChange.mockClear();

    rerender(
      <svg>
        <ExemplarDot
          cx={80}
          cy={140}
          exemplar={exemplar}
          isActive
          onPositionChange={onPositionChange}
        />
      </svg>,
    );

    expect(onPositionChange).toHaveBeenCalledWith(80, 140);
  });

  it('stays quiet when it is not the active marker', () => {
    // Otherwise every marker reports on every frame and nothing reads the rest.
    const onPositionChange = jest.fn();
    renderAt(10, 20, { isActive: false, onPositionChange });

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('does not report before recharts supplies coordinates', () => {
    const onPositionChange = jest.fn();
    render(
      <svg>
        <ExemplarDot
          exemplar={exemplar}
          isActive
          onPositionChange={onPositionChange}
        />
      </svg>,
    );

    expect(onPositionChange).not.toHaveBeenCalled();
  });
});
