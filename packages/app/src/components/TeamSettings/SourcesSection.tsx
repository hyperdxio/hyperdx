import { Trans } from 'next-i18next/pages';
import { Box, Divider, Text } from '@mantine/core';

import { SourcesList } from '@/components/Sources/SourcesList';

export default function SourcesSection() {
  return (
    <Box id="sources" data-testid="sources-section">
      <Text size="md">
        <Trans>Sources</Trans>
      </Text>
      <Divider my="md" />
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
