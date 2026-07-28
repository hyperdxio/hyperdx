import { useTranslation } from 'react-i18next';
import { Box, Card, Divider, Stack, Text } from '@mantine/core';

import WebhooksSection from './WebhooksSection';

export default function IntegrationsSection() {
  const { t } = useTranslation('settings');

  return (
    <Box id="integrations" data-testid="integrations-section">
      <Text size="md">{t('sections.integrations')}</Text>
      <Divider my="md" />
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
    </Box>
  );
}
