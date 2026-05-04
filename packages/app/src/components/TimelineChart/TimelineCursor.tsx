type TimelineCursorProps = {
  xPerc: number;
  overlay?: React.ReactNode;
  labelWidth: number;
  color: string;
  height: number;
};

export function TimelineCursor({
  xPerc,
  overlay,
  labelWidth,
  color,
  height,
}: TimelineCursorProps) {
  // Bound [-1,100] to 6 digits as a percent, -1 so it can slide off the right side of the screen
  const cursorMarginLeft = `${Math.min(Math.max(xPerc * 100, -1), 100).toFixed(
    6,
  )}%`;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        height: 0,
        zIndex: 250,
        pointerEvents: 'none',
        display: xPerc <= 0 ? 'none' : 'block',
      }}
    >
      <div className="d-flex">
        <div style={{ width: labelWidth, minWidth: labelWidth }} />
        <div className="w-100 overflow-hidden">
          <div style={{ marginLeft: cursorMarginLeft }}>
            {overlay != null && (
              <div
                style={{
                  height: 0,
                  marginLeft: xPerc < 0.5 ? 12 : -150,
                  top: 12,
                  position: 'relative',
                }}
              >
                <div>
                  <span
                    className="p-2 rounded border"
                    style={{ background: 'var(--color-bg-surface)' }}
                  >
                    {overlay}
                  </span>
                </div>
              </div>
            )}
            <div
              style={{
                height,
                width: 1,
                background: color,
              }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
