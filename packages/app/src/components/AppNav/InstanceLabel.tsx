import { Badge } from '@mantine/core';

import { INSTANCE_LABEL } from '@/config';

// Styled to match the sidebar's UTC badge; see AppNav.tsx, where the two are
// mutually exclusive (the label takes priority when set).
export function InstanceLabel() {
  if (!INSTANCE_LABEL) {
    return null;
  }
  return (
    <Badge
      size="xs"
      color="gray"
      variant="light"
      fw="normal"
      title={INSTANCE_LABEL}
      style={{ minWidth: 0, maxWidth: 120 }}
    >
      {INSTANCE_LABEL}
    </Badge>
  );
}
