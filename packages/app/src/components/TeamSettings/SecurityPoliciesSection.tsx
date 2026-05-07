import { Trans } from 'next-i18next/pages';
import { Box, Card, Divider, Text } from '@mantine/core';

export default function SecurityPoliciesSection({
  allowedAuthMethods,
}: {
  allowedAuthMethods: string[];
}) {
  return (
    <Box id="security-policies">
      <Text size="md">
        <Trans>Security Policies</Trans>
      </Text>
      <Divider my="md" />
      <Card>
        <Text size="sm" c="dimmed">
          <Trans>Team members can only authenticate via</Trans>{' '}
          <span className="text-capitalize fw-bold">
            {allowedAuthMethods.join(', ')}
          </span>
        </Text>
      </Card>
    </Box>
  );
}
