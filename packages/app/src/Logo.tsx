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
      iconMarginBottom: 3,
    },
    md: {
      fontSize: 16,
      iconSize: 16,
      iconMarginBottom: 3,
    },
    lg: {
      fontSize: 18,
      iconSize: 18,
      iconMarginBottom: 3,
    },
    xl: {
      fontSize: 22,
      iconSize: 22,
      iconMarginBottom: 3,
    },
  };

  return (
    <div
      className="align-items-center d-flex"
      style={{
        color: 'white',
        userSelect: 'none',
      }}
    >
      <div
        className="me-2"
        style={{ marginBottom: configs[size].iconMarginBottom }}
      >
        <Icon size={configs[size].iconSize} />
      </div>

      <span
        className="fw-bold mono"
        style={{
          fontSize: configs[size].fontSize,
        }}
      >
        HyperDX
      </span>
    </div>
  );
}
