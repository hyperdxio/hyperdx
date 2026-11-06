import { Group, Text } from '@mantine/core';

import { useBrandDisplayName } from '@/brand';

import Logomark from './Logomark';

// Height of the symbol next to the name. The collapsed rail passes its own
// size to Logomark and does not use this.
const MARK_HEIGHT = 23;

export default function Wordmark() {
  const brandName = useBrandDisplayName();

  return (
    <Group gap={8} align="center" wrap="nowrap" miw={0}>
      <Logomark size={MARK_HEIGHT} />
      <Text fz={18} fw={500} truncate="end" miw={0}>
        {brandName}
      </Text>
    </Group>
  );
}
