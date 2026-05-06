import { Box, Divider, Text } from '@mantine/core';

import { OnboardingSourcesList } from '@/components/Sources/OnboardingSourcesList';

export default function SourcesSection() {
  return (
    <Box id="sources" data-testid="sources-section">
      <Text size="md">Sources</Text>
      <Divider my="md" />
      <OnboardingSourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
