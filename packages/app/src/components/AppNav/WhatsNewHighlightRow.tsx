import { Badge, Box, Group, Text } from '@mantine/core';

import type { WhatsNew } from './useWhatsNew';

type Headline = WhatsNew['releases'][number]['highlights'][number];

// Fits "Breaking", the wider of the two labels, with a little slack. The badge
// keeps its natural pill width inside this column — the column only exists so
// every headline starts at the same x instead of wherever its own badge ended.
const BADGE_COLUMN_WIDTH = 76;

/**
 * One "Breaking"/"New" headline row, shared by the Help menu's peek and the
 * drawer.
 *
 * Shared rather than written twice because the ragged left edge the badge column
 * fixes was present in both: the markup was duplicated, so fixing the menu left
 * the drawer behind.
 *
 * `lineClamp` is the menu's — only three rows fit there. The drawer has the
 * width to let headlines wrap in full. A clamped row carries a title tooltip so
 * the truncated tail is still readable.
 */
export const WhatsNewHighlightRow = ({
  headline,
  lineClamp,
}: {
  headline: Headline;
  lineClamp?: number;
}) => (
  <Group gap="xs" wrap="nowrap" align="flex-start">
    <Box w={BADGE_COLUMN_WIDTH} flex="none">
      <Badge
        size="sm"
        variant="light"
        color={headline.kind === 'breaking' ? 'red' : 'blue'}
      >
        {headline.kind === 'breaking' ? 'Breaking' : 'New'}
      </Badge>
    </Box>
    {/* flex + miw=0 lets the headline wrap and clamp within the row rather than
        forcing the container wider. */}
    <Text
      data-testid="whats-new-headline"
      size="sm"
      lineClamp={lineClamp}
      title={lineClamp ? headline.text : undefined}
      flex={1}
      miw={0}
    >
      {headline.text}
    </Text>
  </Group>
);
