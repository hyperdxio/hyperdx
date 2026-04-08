import React from 'react';
import cx from 'classnames';

import TabItem from './TabItem';

export default function TabBar<T extends string | number | undefined>({
  items,
  activeItem,
  className,
  style,
  onClick,
  'data-testid': dataTestId,
}: {
  items: Array<{ value: T; text: React.ReactNode }>;
  activeItem: T;
  className?: string | undefined;
  style?: React.CSSProperties;
  onClick?: (item: T) => any;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cx('d-flex flex-wrap', className)}
      style={style}
      data-testid={dataTestId}
    >
      {items.map(item => {
        return (
          <TabItem
            key={item.value}
            data-testid={`tab-${String(item.value).toLowerCase()}`}
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
