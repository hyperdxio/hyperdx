import { Alert, Box, Divider, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

/**
 * Berg compatibility shim. The Connection model is gone — Athena auth comes
 * from pod-level IRSA, configured outside the application. This section is
 * preserved as a placeholder so the Team Settings page anchor (`#connections`)
 * still resolves; we can drop it entirely once the Settings UI is reworked.
 */
export default function ConnectionsSection() {
  return (
    <Box id="connections" data-testid="connections-section">
      <Text size="md">Connections</Text>
      <Divider my="md" />
      <Alert
        icon={<IconInfoCircle size={16} />}
        color="gray"
        variant="light"
        title="Managed by IAM"
      >
        <Text size="sm">
          Berg authenticates to AWS via pod-level IRSA — there are no connection
          records to configure here.
        </Text>
      </Alert>
    </Box>
  );
}
