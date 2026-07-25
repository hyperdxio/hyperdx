import { Anchor, Badge, Box, Group, Menu, Text, Timeline } from '@mantine/core';
import { IconPackageExport } from '@tabler/icons-react';

import { useWhatsNew } from './useWhatsNew';

const PEEK_LIMIT = 3;

// Inline "What's new" peek for the Help menu: the latest release's top feature
// headlines with a "New" badge, on a timeline whose connector runs down into an
// open package on the "View all releases" row (so the updates read as "coming
// out of" the release package). "View all releases" opens the fuller drawer.
// Fetched lazily — `enabled` tracks the Help menu being open.
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

  // Show the newest release that actually has features, not simply the newest
  // release: fix-only patch releases are common (10 of the 71 releases to date
  // parse to zero `feat` entries), and pinning to releases[0] would leave the
  // section blank right when the Help button is sparkling for a new version.
  // The label follows the release being shown, so it never claims features
  // belong to a version they didn't ship in.
  const release = data?.releases?.find(r => r.features.length > 0);
  const features = (release?.features ?? []).slice(0, PEEK_LIMIT);
  const shownVersion = release?.version ?? version;

  return (
    <>
      <Menu.Label>
        What&apos;s new{shownVersion ? ` in v${shownVersion}` : ''}
      </Menu.Label>
      <Box px="sm" py={4} data-testid="whats-new">
        <Timeline bulletSize={18} lineWidth={2} color="blue">
          {features.map(feature => (
            <Timeline.Item
              key={feature.text}
              data-testid="whats-new-item"
              bullet={
                <Box w={8} h={8} bdrs="50%" bg="var(--mantine-color-blue-5)" />
              }
            >
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Badge size="sm" variant="light" color="blue">
                  New
                </Badge>
                {/* flex + miw=0 lets the headline wrap and clamp within the row
                    rather than forcing the menu wider. */}
                <Text
                  size="sm"
                  lineClamp={2}
                  title={feature.text}
                  flex={1}
                  miw={0}
                >
                  {feature.text}
                </Text>
              </Group>
            </Timeline.Item>
          ))}
          {/* Terminal item: the connector line ends at an open package (the
              releases "coming out of" the package). Opens the drawer. */}
          <Timeline.Item bullet={<IconPackageExport size={14} />}>
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
