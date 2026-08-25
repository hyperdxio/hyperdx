import { Anchor, Badge, Box, Group, Menu, Text, Timeline } from '@mantine/core';
import { IconPackageExport } from '@tabler/icons-react';

import { formatCounts, useWhatsNew } from './useWhatsNew';

const PEEK_LIMIT = 3;

// Inline "What's new" peek for the Help menu: the latest release's breaking
// changes and new features, on a timeline whose connector runs down into an open
// package on the "View all releases" row (so the updates read as "coming out of"
// the release package). The improvements and fixes we don't list out are summed
// up above that row. "View all releases" opens the fuller drawer. Fetched
// lazily — `enabled` tracks the Help menu being open.
export const WhatsNewSection = ({
  enabled,
  version,
  onViewAll,
}: {
  enabled: boolean;
  version?: string;
  onViewAll: () => void;
}) => {
  const { data } = useWhatsNew(enabled);

  // Show the newest release that actually has headlines, not simply the newest
  // release: fix-only patch releases happen, and pinning to releases[0] would
  // leave the section blank right when the Help button is sparkling for a new
  // version. The label follows the release being shown, so it never claims
  // changes belong to a version they didn't ship in.
  const release = data?.releases?.find(r => r.highlights.length > 0);
  // Breaking changes first: only PEEK_LIMIT rows fit here, and a breaking change
  // is the one thing a reader must not miss to a feature taking its slot.
  const all = release?.highlights ?? [];
  const highlights = [
    ...all.filter(h => h.kind === 'breaking'),
    ...all.filter(h => h.kind === 'feature'),
  ].slice(0, PEEK_LIMIT);
  const shownVersion = release?.version ?? version;
  const rest = formatCounts(release?.counts ?? []);

  return (
    <>
      <Menu.Label>
        What&apos;s new{shownVersion ? ` in v${shownVersion}` : ''}
      </Menu.Label>
      <Box px="sm" py={4} data-testid="whats-new">
        <Timeline bulletSize={18} lineWidth={2} color="blue">
          {highlights.map(headline => (
            <Timeline.Item
              key={headline.text}
              data-testid="whats-new-item"
              bullet={
                <Box w={8} h={8} bdrs="50%" bg="var(--mantine-color-blue-5)" />
              }
            >
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Badge
                  size="sm"
                  variant="light"
                  color={headline.kind === 'breaking' ? 'red' : 'blue'}
                >
                  {headline.kind === 'breaking' ? 'Breaking' : 'New'}
                </Badge>
                {/* flex + miw=0 lets the headline wrap and clamp within the row
                    rather than forcing the menu wider. */}
                <Text
                  size="sm"
                  lineClamp={2}
                  title={headline.text}
                  flex={1}
                  miw={0}
                >
                  {headline.text}
                </Text>
              </Group>
            </Timeline.Item>
          ))}
          {/* Terminal item: the connector line ends at an open package (the
              releases "coming out of" the package). Opens the drawer. */}
          <Timeline.Item bullet={<IconPackageExport size={14} />}>
            {rest && (
              <Text size="xs" c="dimmed" data-testid="whats-new-peek-counts">
                Plus {rest}
              </Text>
            )}
            <Anchor
              component="button"
              type="button"
              data-testid="view-all-releases-menu-item"
              size="sm"
              c="dimmed"
              onClick={onViewAll}
            >
              View all releases
            </Anchor>
          </Timeline.Item>
        </Timeline>
      </Box>
    </>
  );
};
