import { memo, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Flex, Modal, Stack, Text } from '@mantine/core';

import { useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

/**
 * Berg onboarding modal. The legacy HyperDX flow auto-detected OTel
 * Log/Trace/Session/Metric tables against a ClickHouse connection; in
 * Berg, AWS authentication is handled out-of-band via pod-level IRSA
 * and Sources are created from the Catalog browser. The modal therefore
 * collapses to a single CTA pointing the user at the Catalog page.
 */
function OnboardingModalComponent({
  requireSource = true,
}: {
  requireSource?: boolean;
}) {
  const brandName = useBrandDisplayName();
  const router = useRouter();
  const { data: sources, isLoading } = useSources();

  const shouldOpen =
    requireSource && !isLoading && (sources?.length ?? 0) === 0;

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // If the user navigates back here after creating a Source elsewhere,
    // ensure the modal stays closed.
    if ((sources?.length ?? 0) > 0) {
      setDismissed(true);
    }
  }, [sources]);

  const opened = shouldOpen && !dismissed;

  return (
    <Modal
      data-testid="onboarding-modal"
      opened={opened}
      onClose={() => setDismissed(true)}
      title={`Welcome to ${brandName}`}
      size="lg"
      withCloseButton={false}
    >
      <Stack gap="md">
        <Text size="sm">
          {brandName} reads from AWS S3 Tables via Athena and the Glue Data
          Catalog. AWS credentials are provided to the pod via IRSA — no
          credentials are stored in {brandName}.
        </Text>
        <Text size="sm">
          Browse the Catalog to find a table, then save it as a Source to use
          it in Search and Dashboards.
        </Text>
        <Flex justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setDismissed(true);
              router.push('/catalog');
            }}
          >
            Open Catalog
          </Button>
        </Flex>
      </Stack>
    </Modal>
  );
}

const OnboardingModal = memo(OnboardingModalComponent);
export default OnboardingModal;
