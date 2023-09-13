import { useState } from 'react';

import TabBar from './TabBar';

export default function TabBarWithContent({
  items,
}: {
  items: {
    value: string;
    text: React.ReactNode;
    children: React.ReactNode;
  }[];
}) {
  const [activeItem, setActiveItem] = useState<string | undefined>(
    items[0].value,
  );
  return (
    <div>
      <TabBar
        className="fs-8 mt-3"
        items={items}
        activeItem={activeItem}
        onClick={(value: string | undefined) => setActiveItem(value)}
      />
      {items.map(item => {
        return (
          <div
            key={item.value}
            className="mt-3"
            style={{ display: item.value === activeItem ? 'block' : 'none' }}
          >
            {item.children}
          </div>
        );
      })}
    </div>
  );
}
