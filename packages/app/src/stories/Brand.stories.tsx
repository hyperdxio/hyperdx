import { Group, Paper, Stack, Text } from '@mantine/core';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';
import {
  useBrandDisplayName,
  useLogomark,
  useThemeName,
  useWordmark,
} from '@/theme/ThemeProvider';

import { AssetCard } from './AssetCard';

const story = {
  title: 'Brand/Logo',
  parameters: {
    layout: 'padded',
  },
};
export default story;

const USAGE = `import { useWordmark, useLogomark } from '@/theme/ThemeProvider';

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
  const brand = useBrandDisplayName();
  const themeName = useThemeName();
  const logomark16 = useLogomark({ size: 16 });
  const logomark24 = useLogomark({ size: 24 });
  const logomark48 = useLogomark({ size: 48 });
  const logomarkDownload = useLogomark({ size: 48 });
  const wordmark = useWordmark();
  const wordmarkIsSvg = themeName === 'clickstack';

  return (
    <Stack gap="xl" maw={720} mx="auto">
      <div>
        <Text size="lg" fw={700}>
          {brand} logo
        </Text>
        <Text size="sm" c="var(--color-text-muted)">
          Use the Brand toolbar to switch HyperDX and ClickStack, and the Theme
          toolbar for light and dark. Prefer{' '}
          <Text span ff="monospace" size="sm">
            useLogomark
          </Text>{' '}
          and{' '}
          <Text span ff="monospace" size="sm">
            useWordmark
          </Text>{' '}
          so the active brand is used automatically.
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
          title={`${brand} logomark`}
          description="Download the SVG as authored (brand fills or currentColor)."
          filename={`${themeName}-logomark.svg`}
        >
          {logomarkDownload}
        </AssetCard>
      </div>

      <div>
        <Text size="sm" fw={600} mb="sm">
          Wordmark
        </Text>
        <Text size="xs" c="var(--color-text-muted)" mb="sm">
          {wordmarkIsSvg
            ? 'Full brand lockup as a single SVG.'
            : 'Logomark plus the HyperDX label in UI type. Download the logomark SVG above; the wordmark is not a standalone SVG.'}
        </Text>
        {wordmarkIsSvg ? (
          <AssetCard
            title={`${brand} wordmark`}
            filename={`${themeName}-wordmark.svg`}
          >
            {wordmark}
          </AssetCard>
        ) : (
          <Paper p="md" withBorder radius="md">
            {wordmark}
          </Paper>
        )}
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
