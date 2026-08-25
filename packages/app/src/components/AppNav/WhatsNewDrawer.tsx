import ReactMarkdown from 'react-markdown';
import {
  Anchor,
  Badge,
  Card,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconPackageExport } from '@tabler/icons-react';

import { changelogUrl, formatCounts, useWhatsNew } from './useWhatsNew';

// Link targets the release summary may point at.
//
// Kept in sync with ALLOWED_LINK_HOSTS in .github/scripts/release-notes.mjs, and
// pinned there by a test.
const ALLOWED_LINK_HOSTS = new Set(['github.com', 'docs.hyperdx.io']);

/**
 * Allowlist link targets in the release summary.
 *
 * The summary is written during the release from changeset bodies, commit
 * messages and PR titles — all of which anyone opening a PR can influence — so
 * an off-site link is a phishing surface in every deployment's "What's new". The
 * release workflow greps for disallowed links before publishing, but grep cannot
 * be complete over CommonMark (a bare autolink `<https://host/x>` carries no
 * `](`), so the enforceable check belongs here, where react-markdown hands us
 * the parsed target whatever syntax produced it.
 *
 * Returning '' is react-markdown's own convention for a rejected URL — it is
 * what the library's `defaultUrlTransform` returns for unsafe protocols.
 */
export function allowChangelogUrl(url: string): string {
  try {
    // The base makes a relative target resolve to a host that is never allowed,
    // rather than throwing.
    const parsed = new URL(url, 'https://disallowed.invalid');
    if (parsed.protocol !== 'https:') return '';
    return ALLOWED_LINK_HOSTS.has(parsed.hostname) ? url : '';
  } catch {
    return '';
  }
}

// The fuller "What's new" surface: a scrollable feed of recent releases. Each
// leads with the headline and summary the release notes open with, then its
// breaking changes and new features, then a link to the improvements and fixes
// on GitHub. Falls back to a link out to the complete changelog.
export const WhatsNewDrawer = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const { data, isError } = useWhatsNew(opened);
  const releases = data?.releases;

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
              href={changelogUrl()}
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
                  {release.date && (
                    <Text size="xs" c="dimmed">
                      {release.date}
                    </Text>
                  )}
                </Group>

                {(release.title || release.summary) && (
                  <Card withBorder radius="md" padding="md">
                    {release.title && (
                      <Text fw={600} mb={4} data-testid="whats-new-title">
                        {release.title}
                      </Text>
                    )}
                    {release.summary && (
                      <div className="hdx-markdown">
                        {/* Images are dropped outright and link targets
                            allowlisted at the AST level, so no markdown syntax —
                            inline, reference-style or autolink — can smuggle an
                            off-site image or link in here. */}
                        <ReactMarkdown
                          disallowedElements={['img']}
                          urlTransform={allowChangelogUrl}
                        >
                          {release.summary}
                        </ReactMarkdown>
                      </div>
                    )}
                  </Card>
                )}

                {release.highlights.length > 0 && (
                  <Stack gap={6}>
                    {release.highlights.map(headline => (
                      <Group
                        key={headline.text}
                        gap="xs"
                        wrap="nowrap"
                        align="flex-start"
                      >
                        <Badge
                          size="sm"
                          variant="light"
                          color={headline.kind === 'breaking' ? 'red' : 'blue'}
                          flex="0 0 auto"
                        >
                          {headline.kind === 'breaking' ? 'Breaking' : 'New'}
                        </Badge>
                        <Text size="sm" flex={1} miw={0}>
                          {headline.text}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                )}

                {/* Improvements and fixes are counted rather than listed — the
                    link goes to the release's own section of the changelog, so
                    the reader lands on the detail instead of the file top. */}
                {release.counts.length > 0 && (
                  <Anchor
                    href={`${changelogUrl(release.version)}#${release.anchor}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    c="dimmed"
                    data-testid="whats-new-counts"
                  >
                    {formatCounts(release.counts)}
                  </Anchor>
                )}

                <Divider />
              </Stack>
            ))}

            <Anchor
              href={changelogUrl(releases[0]?.version)}
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
