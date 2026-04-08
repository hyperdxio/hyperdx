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
  const interval = calculateInterval(scaledMaxVal);

  const numTicks = Math.floor(maxVal / interval);
  const percSpacing = (interval / maxVal) * 100 * scale;

  const labels = [];
  const gridLines = [];
  for (let i = 0; i < numTicks; i++) {
    const ml = i === 0 ? 0 : `${percSpacing.toFixed(6)}%`;
    labels.push(
      <div
        key={i}
        style={{
          width: 1,
          marginRight: -1,
          marginLeft: ml,
          background: 'var(--color-border-muted)',
          height: '100%',
        }}
      >
        <div className="ms-2 fs-8.5">{renderMs(i * interval)}</div>
      </div>,
    );
    gridLines.push(
      <div
        key={i}
        style={{
          width: 1,
          marginRight: -1,
          marginLeft: ml,
          background: 'var(--color-border-muted)',
          height: '100%',
        }}
      />,
    );
  }

  const offsetMargin = `${(-1 * offset * scale).toFixed(6)}%`;

  return (
    <>
      {/* Grid lines — behind rows */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      >
        <div className="d-flex align-items-stretch" style={{ height: '100%' }}>
          <div style={{ width: labelWidth, minWidth: labelWidth }} />
          <div className="d-flex w-100 overflow-hidden">
            <div style={{ marginRight: offsetMargin }} />
            {gridLines}
          </div>
        </div>
      </div>

      {/* Sticky header with labels — above rows */}
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
          <div style={{ width: labelWidth, minWidth: labelWidth }} />
          <div className="d-flex w-100 overflow-hidden">
            <div style={{ marginRight: offsetMargin }} />
            {labels}
          </div>
        </div>
      </div>
    </>
  );
}
