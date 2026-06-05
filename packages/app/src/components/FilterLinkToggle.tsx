import { ActionIcon, Tooltip } from '@mantine/core';
import { IconArrowsLeftRight } from '@tabler/icons-react';

type FilterLinkToggleProps = {
  linked: boolean;
  onChange: (linked: boolean) => void;
  'data-testid'?: string;
};

/**
 * Opt-in toggle that "links" a set of filter dropdowns so each one's selectable
 * values are narrowed by the others' current selections (faceted / filter-aware
 * values). Off by default because contingent value lookups can't be served from
 * the cheap per-key rollups and are far more expensive at scale.
 */
export function FilterLinkToggle({
  linked,
  onChange,
  'data-testid': dataTestId = 'filter-link-toggle',
}: FilterLinkToggleProps) {
  return (
    <Tooltip
      withinPortal
      multiline
      w={250}
      label={
        linked
          ? 'Filters are linked: each dropdown only shows values that match the other selections. Click to unlink.'
          : 'Link filters: narrow each dropdown to values that match the other selections (filter-aware). May be slower on large datasets.'
      }
    >
      <ActionIcon
        variant={linked ? 'filled' : 'subtle'}
        color={linked ? 'green' : 'gray'}
        onClick={() => onChange(!linked)}
        aria-label="Link filters"
        aria-pressed={linked}
        data-testid={dataTestId}
      >
        <IconArrowsLeftRight size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
