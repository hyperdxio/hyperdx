import { ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  ScrollArea,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { useId } from '@mantine/hooks';
import { IconX } from '@tabler/icons-react';

export type RailSection = 'display' | 'rowClick';

export type RailSectionOption = { value: RailSection; label: string };

/**
 * The single docked "Tile settings" inspector that replaces the stack of
 * overlay drawers (Display Settings, Row Click Action, ...). A pinned header
 * with a close button sits on top, an optional section switcher lets the user
 * move between the available sections without stacking anything, and only the
 * body scrolls. Chrome mirrors the former SettingsSidePanel so the docked
 * layout (full-height left border meeting the editor header underline) is
 * unchanged.
 */
export default function TileSettingsRail({
  section,
  sections,
  onSectionChange,
  onClose,
  children,
  'data-testid': dataTestId,
}: {
  section: RailSection;
  sections: RailSectionOption[];
  onSectionChange: (section: RailSection) => void;
  onClose: () => void;
  children: ReactNode;
  'data-testid'?: string;
}) {
  // Preserve an accessible landmark: a labelled region whose name comes from
  // the heading, matching the former Drawer's role="dialog" accessible name.
  const titleId = useId();
  return (
    <Box
      data-testid={dataTestId}
      role="region"
      aria-labelledby={titleId}
      style={{
        flexShrink: 0,
        // Cap the rail but yield to the editor column on narrow viewports (it
        // lives inside a wide drawer), so the editor is never crushed.
        width: 'min(340px, 45%)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        px="md"
        py="sm"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Text id={titleId} component="h2" size="sm" fw={600} m={0}>
          Tile settings
        </Text>
        <Tooltip label="Close" position="bottom">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onClose}
            aria-label="Close tile settings"
            data-testid="settings-panel-close-button"
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {sections.length > 1 && (
        <Box px="md" pt="sm">
          <SegmentedControl
            fullWidth
            size="xs"
            value={section}
            onChange={value => onSectionChange(value as RailSection)}
            data={sections}
            data-testid="tile-settings-section-switcher"
          />
        </Box>
      )}
      <ScrollArea
        scrollbars="y"
        style={{ flex: 1, minHeight: 0 }}
        px="md"
        py="md"
      >
        {children}
      </ScrollArea>
    </Box>
  );
}
