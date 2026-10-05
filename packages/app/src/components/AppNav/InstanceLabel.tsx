import { ReactNode } from 'react';
import { Badge } from '@mantine/core';

import { INSTANCE_LABEL } from '@/config';

// Styled to match the sidebar's UTC badge. `fallback` lets AppNav render the
// UTC badge in the same slot without needing its own INSTANCE_LABEL check -
// this component owns the one guard for whether a label is configured.
export function InstanceLabel({ fallback = null }: { fallback?: ReactNode }) {
  if (!INSTANCE_LABEL) {
    return fallback;
  }
  return (
    <Badge
      size="xs"
      color="gray"
      variant="light"
      fw="normal"
      tt="none"
      title={INSTANCE_LABEL}
      style={{ minWidth: 0, maxWidth: 120 }}
    >
      {INSTANCE_LABEL}
    </Badge>
  );
}
