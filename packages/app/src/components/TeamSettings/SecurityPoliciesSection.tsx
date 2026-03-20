import { Box, Card, Divider, Text } from '@mantine/core';

export default function SecurityPoliciesSection({
  allowedAuthMethods,
}: {
  allowedAuthMethods: string[];
}) {
  return (
    <Box id="security-policies">
      <Text size="md">Security Policies</Text>
      <Divider my="md" />
      <Card>
        <Text size="sm" c="dimmed">
          Team members can only authenticate via{' '}
          <span className="text-capitalize fw-bold">
            {allowedAuthMethods.join(', ')}
          </span>
        </Text>
      </Card>
    </Box>
  );
}
