import { useRouter } from 'next/router';
import ReactMarkdown from 'react-markdown';
import {
  Anchor,
  Badge,
  Card,
  Center,
  Divider,
  Drawer,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconPackageExport } from '@tabler/icons-react';

import { CHANGELOG_URL, useWhatsNew } from './useWhatsNew';

// The fuller "What's new" surface: a scrollable feed of recent releases. Each
// shows its auto-parsed feature headlines, and — when one has been hand-authored
// — a richer highlight hero (title, markdown blurb, optional image). Falls back
// to a link out to the complete changelog on GitHub.
export const WhatsNewDrawer = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const { basePath } = useRouter();
  const { data, isError } = useWhatsNew(opened);
  const releases = data?.releases;

  // Local highlight images ship under the app's basePath; external URLs pass
  // through untouched.
  const resolveImage = (src: string) =>
    /^https?:\/\//.test(src)
      ? src
      : `${basePath}${src.startsWith('/') ? '' : '/'}${src}`;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={
        <Group gap="xs">
          <IconPackageExport size={18} />
          <Text fw={600}>What&apos;s new</Text>
        </Group>
      }
    >
      {/* The testid goes on a wrapper rather than on <Drawer> itself: Mantine
          spreads extra props onto the modal-base root, which is a zero-height
          positioning container that never reads as visible. Same pattern as
          SessionSidePanel. */}
      <div data-testid="whats-new-drawer">
        {isError ? (
          <Text size="sm" c="dimmed">
            Unable to load recent releases.{' '}
            <Anchor
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the changelog on GitHub
            </Anchor>
            .
          </Text>
        ) : releases == null ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : (
          <Stack gap="xl">
            {releases.map((release, idx) => (
              <Stack
                gap="sm"
                key={release.version}
                data-testid="whats-new-release"
              >
                <Group gap="xs">
                  <Title order={4}>v{release.version}</Title>
                  {idx === 0 && (
                    <Badge variant="light" color="blue">
                      Latest
                    </Badge>
                  )}
                </Group>

                {release.highlight && (
                  <Card withBorder radius="md" padding="md">
                    {release.highlight.image && (
                      <Card.Section mb="sm">
                        <Image
                          src={resolveImage(release.highlight.image)}
                          alt=""
                          loading="lazy"
                        />
                      </Card.Section>
                    )}
                    <Text fw={600} mb={4}>
                      {release.highlight.title}
                    </Text>
                    <div className="hdx-markdown">
                      <ReactMarkdown>{release.highlight.blurb}</ReactMarkdown>
                    </div>
                  </Card>
                )}

                {release.features.length > 0 && (
                  <Stack gap={6}>
                    {release.features.map(feature => (
                      <Group
                        key={feature.text}
                        gap="xs"
                        wrap="nowrap"
                        align="flex-start"
                      >
                        {/* The feat() scope (or "general") tags each change. */}
                        <Badge
                          size="sm"
                          variant="light"
                          color="gray"
                          flex="0 0 auto"
                        >
                          {feature.scope}
                        </Badge>
                        <Text size="sm" flex={1} miw={0}>
                          {feature.text}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                )}

                <Divider />
              </Stack>
            ))}

            <Anchor
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              data-testid="drawer-github-link"
            >
              View full changelog on GitHub →
            </Anchor>
          </Stack>
        )}
      </div>
    </Drawer>
  );
};
