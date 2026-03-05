import { calculateInterval, renderMs } from './utils';

export function TimelineXAxis({
  maxVal,
  labelWidth,
  height,
  scale,
  offset,
}: {
  maxVal: number;
  labelWidth: number;
  height: number;
  scale: number;
  offset: number;
}) {
  const scaledMaxVal = maxVal / scale;
  // TODO: Turn this into a function
  const interval = calculateInterval(scaledMaxVal);

  const numTicks = Math.floor(maxVal / interval);
  const percSpacing = (interval / maxVal) * 100 * scale;

  const ticks = [];
  for (let i = 0; i < numTicks; i++) {
    ticks.push(
      <div
        key={i}
        style={{
          height,
          width: 1,
          marginRight: -1,
          marginLeft: i === 0 ? 0 : `${percSpacing.toFixed(6)}%`,
          background: 'var(--color-border-muted)',
        }}
      >
        <div className="ms-2 fs-8.5">{renderMs(i * interval)}</div>
      </div>,
    );
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        height: 24,
        paddingTop: 4,
        zIndex: 200,
        pointerEvents: 'none',
        background: 'var(--color-bg-body)',
      }}
    >
      <div className="d-flex align-items-center">
        <div style={{ width: labelWidth, minWidth: labelWidth }}></div>
        <div className="d-flex w-100 overflow-hidden">
          <div
            style={{ marginRight: `${(-1 * offset * scale).toFixed(6)}%` }}
          ></div>
          {ticks}
        </div>
      </div>
    </div>
  );
}
