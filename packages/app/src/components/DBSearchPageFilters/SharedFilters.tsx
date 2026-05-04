import { memo, type ReactNode } from 'react';
import {
  ActionIcon,
  Collapse,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconFilterOff, IconUsers } from '@tabler/icons-react';

interface SharedFiltersSectionProps {
  /** Whether there are any shared facets to display */
  hasSharedFacets: boolean;
  /** Whether the section is expanded */
  opened: boolean;
  /** Toggle the section open/closed */
  onToggle: VoidFunction;
  /** Whether any shared facets have active filter selections */
  showClearButton: boolean;
  /** Callback to clear all shared filter selections */
  onClearSelections: VoidFunction;
  /** Pre-rendered FilterGroup components for shared/pinned facets */
  children: ReactNode;
}

/**
 * Collapsible "Shared Filters" section header.
 * Wraps pre-rendered FilterGroup components passed as children.
 * This avoids duplicating FilterGroup logic — the parent renders real
 * FilterGroup components with full distribution/load-more support.
 */
function SharedFiltersSectionComponent({
  hasSharedFacets,
  opened,
  onToggle,
  showClearButton,
  onClearSelections,
  children,
}: SharedFiltersSectionProps) {
  if (!hasSharedFacets) {
    return null;
  }

  return (
    <Stack gap="xs" data-testid="shared-filters-section">
      <Flex align="center" justify="space-between">
        <UnstyledButton
          onClick={onToggle}
          data-testid="shared-filters-toggle"
          style={{ flex: 1 }}
        >
          <Group gap={4}>
            <IconUsers
              size={12}
              style={{ color: 'var(--mantine-color-gray-6)' }}
            />
            <Text size="xxs" c="dimmed" fw="bold">
              Shared Filters
            </Text>
          </Group>
        </UnstyledButton>
        <Group gap={0} wrap="nowrap">
          {showClearButton && (
            <Tooltip
              label="Clear Shared Filters"
              position="top"
              withArrow
              fz="xxs"
              color="gray"
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="xs"
                onClick={onClearSelections}
                aria-label="Clear Shared Filters"
              >
                <IconFilterOff size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          <UnstyledButton onClick={onToggle}>
            <IconChevronDown
              size={14}
              color="var(--mantine-color-gray-6)"
              style={{
                transition: 'transform 0.2s ease-in-out',
                transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            />
          </UnstyledButton>
        </Group>
      </Flex>
      <Collapse expanded={opened}>
        <Stack gap={8}>{children}</Stack>
      </Collapse>
    </Stack>
  );
}

export const SharedFiltersSection = memo(SharedFiltersSectionComponent);
