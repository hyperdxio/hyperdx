import React from 'react';

import Icon from './Icon';

export default function Logo({
  size = 'sm',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const configs = {
    sm: {
      fontSize: 14,
      iconSize: 14,
    },
    md: {
      fontSize: 16,
      iconSize: 16,
    },
    lg: {
      fontSize: 18,
      iconSize: 18,
    },
    xl: {
      fontSize: 22,
      iconSize: 22,
    },
  };

  return (
    <div className="align-items-center d-flex">
      <div
        className="me-2"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Icon size={configs[size].iconSize} />
      </div>

      <span
        className="fw-bold"
        style={{
          fontSize: configs[size].fontSize,
          fontFamily: 'var(--font-inter), sans-serif',
        }}
      >
        ClickStack
      </span>
    </div>
  );
}
