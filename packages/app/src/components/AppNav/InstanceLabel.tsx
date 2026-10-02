import { Text } from '@mantine/core';

import { INSTANCE_LABEL } from '@/config';

export function InstanceLabel() {
  if (!INSTANCE_LABEL) {
    return null;
  }
  return (
    <Text component="span" fw={700} ff="monospace" fz={15}>
      {INSTANCE_LABEL}
    </Text>
  );
}
