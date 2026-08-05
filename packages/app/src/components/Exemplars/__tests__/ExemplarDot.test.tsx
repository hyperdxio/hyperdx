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
