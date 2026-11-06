import { Group, Text } from '@mantine/core';

import Logomark from './Logomark';

// The brand lockup: a 23px symbol, an 8px gap, and the name in Inter 18px
// medium. The name is passed in so this file does not import the brand barrel,
// which imports this file.
const MARK_HEIGHT = 23;

export default function Wordmark({ name }: { name: string }) {
  return (
    <Group gap={8} align="center" wrap="nowrap" miw={0}>
      <Logomark size={MARK_HEIGHT} fit="symbol" />
      <Text fz={18} fw={500} truncate="end" miw={0}>
        {name}
      </Text>
    </Group>
  );
}
