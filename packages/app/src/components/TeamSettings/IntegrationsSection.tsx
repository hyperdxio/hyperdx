import { Box, Card, Divider, Stack, Text } from '@mantine/core';

import AgentsSection from './AgentsSection';
import WebhooksSection from './WebhooksSection';

export default function IntegrationsSection() {
  return (
    <Box id="integrations" data-testid="integrations-section">
      <Text size="md">Integrations</Text>
      <Divider my="md" />
      <Card>
        <Stack gap="md">
          <WebhooksSection />
        </Stack>
      </Card>
      {/* Renders nothing unless managed agents are enabled on the deployment. */}
      <AgentsSection />
    </Box>
  );
}
