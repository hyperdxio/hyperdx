import { useTranslation } from 'react-i18next';
import { Box, Divider, Text } from '@mantine/core';

import { SourcesList } from '@/components/Sources/SourcesList';

export default function SourcesSection() {
  const { t } = useTranslation('settings');

  return (
    <Box id="sources" data-testid="sources-section">
      <Text size="md">{t('sections.sources')}</Text>
      <Divider my="md" />
      <SourcesList
        withBorder={false}
        variant="default"
        showEmptyState={false}
      />
    </Box>
  );
}
