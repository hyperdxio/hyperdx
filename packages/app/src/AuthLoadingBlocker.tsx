import { useEffect, useRef, useState } from 'react';

import api from './api';

export default function AuthLoadingBlocker() {
  const { data: meData } = api.useMe();

  // increase number of periods rendered as a loading animation, 1 period per second
  const [periods, setPeriods] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setPeriods(periods => (periods + 1) % 4);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {meData == null && (
        <div
          className="bg-body fixed-top vh-100 vw-100 top-0 start-0 d-flex align-items-center justify-content-center"
          style={{
            zIndex: 2147483647,
          }}
        >
          Loading HyperDX
          <span style={{ width: 0 }}>{'.'.repeat(periods)}</span>
        </div>
      )}
    </>
  );
}
