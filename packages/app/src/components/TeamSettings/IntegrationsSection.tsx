import { Trans } from 'next-i18next/pages';
import { Box, Card, Divider, Stack, Text } from '@mantine/core';

import WebhooksSection from './WebhooksSection';

export default function IntegrationsSection() {
  return (
    <Box id="integrations" data-testid="integrations-section">
      <Text size="md">
        <Trans>Integrations</Trans>
      </Text>
      <Divider my="md" />
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
    </Box>
  );
}
