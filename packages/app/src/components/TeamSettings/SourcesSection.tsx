import { Box, Divider, Text } from '@mantine/core';

import { SourcesList } from '@/components/Sources/SourcesList';

export default function SourcesSection() {
  return (
    <Box id="sources" data-testid="sources-section">
      <Text size="md">Sources</Text>
      <Divider my="md" />
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
