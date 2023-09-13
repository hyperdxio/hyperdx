import cx from 'classnames';

export default function TabItem({
  children,
  onClick,
  active,
  className,
  style,
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
    >
      <span>{children}</span>
      <div className="w-100 mt-2" style={{ height: 4 }}>
        <div
          className="h-100 w-100"
          style={{
            background: active ? '#50FA7B' : '#242d33',
          }}
        ></div>
      </div>
    </div>
  );
}
