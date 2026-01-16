import React from 'react';

import Icon from './Icon';

export default function Logo() {
  return (
    <div className="align-items-center d-flex">
      <div
        className="me-2"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Icon size={14} />
      </div>

      <span
        className="fw-bold mono"
        style={{
          fontSize: 14,
        }}
      >
        HyperDX
      </span>
    </div>
  );
}
