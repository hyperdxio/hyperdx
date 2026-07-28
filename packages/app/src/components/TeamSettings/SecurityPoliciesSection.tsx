import { Trans, useTranslation } from 'react-i18next';
import { Box, Card, Divider, Text } from '@mantine/core';

export default function SecurityPoliciesSection({
  allowedAuthMethods,
}: {
  allowedAuthMethods: string[];
}) {
  const { t } = useTranslation('settings');

  return (
    <Box id="security-policies">
      <Text size="md">{t('sections.securityPolicies')}</Text>
      <Divider my="md" />
      <Card>
        <Text size="sm" c="dimmed">
          <Trans
            t={t}
            i18nKey="securityPolicies.description"
            values={{ methods: allowedAuthMethods.join(', ') }}
            components={{
              methods: <span className="text-capitalize fw-bold" />,
            }}
          />
        </Text>
      </Card>
    </Box>
  );
}
