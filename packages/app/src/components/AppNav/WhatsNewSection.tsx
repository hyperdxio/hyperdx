import cx from 'classnames';
import {
  Box,
  Button,
  Menu,
  Text,
  Timeline,
  VisuallyHidden,
} from '@mantine/core';
import { IconArrowRight, IconPackageExport } from '@tabler/icons-react';

import { SparkleGlyph } from './HelpSparkle';
import { formatCounts, useWhatsNew } from './useWhatsNew';
import { WhatsNewHighlightRow } from './WhatsNewHighlightRow';

import styles from './AppNav.module.scss';

const PEEK_LIMIT = 3;

// Inline "What's new" peek for the Help menu: the latest release's breaking
// changes and new features, on a timeline whose connector runs down into an open
// package on the "View all releases" row (so the updates read as "coming out of"
// the release package). The improvements and fixes we don't list out are summed
// up above that row. "View all releases" opens the fuller drawer. Fetched
// lazily — `enabled` tracks the Help menu being open.
export const WhatsNewSection = ({
  enabled,
  hasUnseen,
  version,
  onViewAll,
}: {
  enabled: boolean;
  hasUnseen: boolean;
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
      {/* The section renders the same whether or not there's anything new, so
          the sparkle is the only thing marking "new since you last looked".
          aria-hidden (SparkleGlyph's default) rather than another labelled
          image: the label text beside it is already announced. */}
      <Menu.Label>
        {hasUnseen && (
          <>
            <SparkleGlyph
              data-testid="whats-new-label-sparkle"
              className={cx(styles.sparkleGlyph, styles.whatsNewLabelSparkle)}
            />
            {/* The glyph is decorative, and the nav item's "New updates
                available" label is gone by now, so without this a screen
                reader gets no "since you last looked" signal at all. */}
            <VisuallyHidden>New since your last visit:</VisuallyHidden>
          </>
        )}
        What&apos;s new{shownVersion ? ` in v${shownVersion}` : ''}
      </Menu.Label>
      <Box px="sm" py={4} data-testid="whats-new">
        <Timeline bulletSize={18} lineWidth={2} color="blue">
          {highlights.map(headline => (
            <Timeline.Item
              // Kind included: a release can word a breaking change and a
              // feature identically.
              key={`${headline.kind}-${headline.text}`}
              data-testid="whats-new-item"
              bullet={
                <Box w={8} h={8} bdrs="50%" bg="var(--mantine-color-blue-5)" />
              }
            >
              <WhatsNewHighlightRow headline={headline} lineClamp={2} />
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
            {/* Deliberately `secondary`, not the `link` variant code_style.md
                nominates for navigation CTAs: sat under the dimmed counts line,
                link styling read as a third line of prose rather than the
                section's one action. */}
            <Button
              data-testid="view-all-releases-menu-item"
              variant="secondary"
              size="compact-sm"
              mt={6}
              // Cancel the button's own padding so the label aligns with the
              // counts text above. Via `style`, not `ml` — spacing props run
              // through getSpacing(), which mangles a calc() into a var name.
              style={{ marginLeft: 'calc(var(--button-padding-x) * -1)' }}
              rightSection={<IconArrowRight size={14} />}
              onClick={onViewAll}
            >
              View all releases
            </Button>
          </Timeline.Item>
        </Timeline>
      </Box>
    </>
  );
};
