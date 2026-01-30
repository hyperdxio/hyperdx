import React from 'react';

import Logomark from './Logomark';

export default function Wordmark() {
  return (
    <div className="align-items-center d-flex">
      <div
        className="me-2"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Logomark size={20} />
      </div>

      <span
        className="fw-bold mono"
        style={{
          fontSize: 15,
        }}
      >
        HyperDX
      </span>
    </div>
  );
}
