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
      // Capped well under the sidebar's available width (wordmark + gap +
      // collapse button) so a long label can't push the header's content past
      // one line: `.header`'s flex-wrap:wrap decides line breaks using each
      // item's pre-shrink hypothetical size, not its post-shrink size, so
      // min-width:0 alone doesn't prevent a maxed-out badge from wrapping the
      // collapse button onto a second, clipped line.
      style={{ minWidth: 0, maxWidth: 80 }}
    >
      {INSTANCE_LABEL}
    </Badge>
  );
}
