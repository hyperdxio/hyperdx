import { Group, Stack, Text } from '@mantine/core';

import { BRAND_DISPLAY_NAME, useLogomark, useWordmark } from '@/brand';
import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';

import { AssetCard } from './AssetCard';

const story = {
  title: 'Brand/Logo',
  parameters: {
    layout: 'padded',
  },
};
export default story;

const USAGE = `import { useLogomark, useWordmark } from '@/brand';

function TopBar() {
  const logo = useLogomark({ size: 24 });
  const wordmark = useWordmark();
  return (
    <Group>
      {logo}
      {wordmark}
    </Group>
  );
}`;

export const Logos = () => {
  const logomark16 = useLogomark({ size: 16 });
  const logomark24 = useLogomark({ size: 24 });
  const logomark48 = useLogomark({ size: 48 });
  const logomarkDownload = useLogomark({ size: 48 });
  const wordmark = useWordmark();

  return (
    <Stack gap="xl" maw={720} mx="auto">
      <div>
        <Text size="lg" fw={700}>
          {BRAND_DISPLAY_NAME} logo
        </Text>
        <Text size="sm" c="var(--color-text-muted)">
          Use the Theme toolbar for light and dark. Read the marks from{' '}
          <Text span ff="monospace" size="sm">
            useLogomark
          </Text>{' '}
          and{' '}
          <Text span ff="monospace" size="sm">
            useWordmark
          </Text>
          .
        </Text>
      </div>

      <div>
        <Text size="sm" fw={600} mb="sm">
          Logomark
        </Text>
        <Text size="xs" c="var(--color-text-muted)" mb="sm">
          Icon-only mark. Used in the collapsed sidenav and other compact
          chrome.
        </Text>
        <Group align="flex-end" gap="lg" mb="md">
          <Stack gap={4} align="center">
            {logomark16}
            <Text size="xs" c="var(--color-text-muted)">
              16
            </Text>
          </Stack>
          <Stack gap={4} align="center">
            {logomark24}
            <Text size="xs" c="var(--color-text-muted)">
              24
            </Text>
          </Stack>
          <Stack gap={4} align="center">
            {logomark48}
            <Text size="xs" c="var(--color-text-muted)">
              48
            </Text>
          </Stack>
        </Group>
        <AssetCard
          title={`${BRAND_DISPLAY_NAME} logomark`}
          description="Download the SVG as authored (brand fills or currentColor)."
          filename="clickstack-logomark.svg"
        >
          {logomarkDownload}
        </AssetCard>
      </div>

      <div>
        <Text size="sm" fw={600} mb="sm">
          Wordmark
        </Text>
        <Text size="xs" c="var(--color-text-muted)" mb="sm">
          Full brand lockup as a single SVG.
        </Text>
        <AssetCard
          title={`${BRAND_DISPLAY_NAME} wordmark`}
          filename="clickstack-wordmark.svg"
        >
          {wordmark}
        </AssetCard>
      </div>

      <div>
        <Text size="sm" fw={600} mb="sm">
          Usage
        </Text>
        <CopySnippet snippet={USAGE} />
      </div>
    </Stack>
  );
};
