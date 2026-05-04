import cx from 'classnames';

export default function TabItem({
  children,
  onClick,
  active,
  className,
  style,
  ...props
}: any) {
  return (
    <div
      className={cx(
        'text-center cursor-pointer',
        {
          'fw-bold text-white-hover': active,
          'text-muted-hover': !active,
        },
        className,
      )}
      onClick={onClick}
      style={style}
      {...props}
    >
      <span>{children}</span>
      <div className="w-100 mt-2" style={{ height: 2 }}>
        <div
          className="h-100 w-100"
          style={{
            background: active
              ? 'var(--color-text-brand)'
              : 'var(--color-border)',
          }}
        ></div>
      </div>
    </div>
  );
}
