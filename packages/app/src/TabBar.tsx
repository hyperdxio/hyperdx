import cx from 'classnames';

import TabItem from './TabItem';

export default function TabBar<T extends string | number | undefined>({
  items,
  activeItem,
  className,
  onClick,
}: {
  items: Array<{ value: T; text: React.ReactNode }>;
  activeItem: T;
  className?: string | undefined;
  onClick?: (item: T) => any;
}) {
  return (
    <div className={cx('d-flex flex-wrap', className)}>
      {items.map(item => {
        return (
          <TabItem
            key={item.value}
            active={item.value === activeItem}
            onClick={() => onClick?.(item.value)}
          >
            <span className="mx-4 text-nowrap">{item.text}</span>
          </TabItem>
        );
      })}
      {/* Fill the rest of the space */}
      <TabItem className="flex-grow-1 pe-none">&nbsp;</TabItem>
    </div>
  );
}
