import { memo, type ReactNode } from 'react';
import {
  Collapse,
  Flex,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconUsers } from '@tabler/icons-react';

interface SharedFiltersSectionProps {
  /** Whether there are any shared facets to display */
  hasSharedFacets: boolean;
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
  children,
}: SharedFiltersSectionProps) {
  const [opened, { toggle }] = useDisclosure(true);

  if (!hasSharedFacets) {
    return null;
  }

  return (
    <Stack gap="xs" data-testid="shared-filters-section">
      <UnstyledButton onClick={toggle} data-testid="shared-filters-toggle">
        <Flex align="center" justify="space-between">
          <Group gap={4}>
            <IconUsers
              size={12}
              style={{ color: 'var(--mantine-color-gray-6)' }}
            />
            <Text size="xxs" c="dimmed" fw="bold">
              Shared Filters
            </Text>
          </Group>
          <IconChevronDown
            size={14}
            color="var(--mantine-color-gray-6)"
            style={{
              transition: 'transform 0.2s ease-in-out',
              transform: opened ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </Flex>
      </UnstyledButton>
      <Collapse in={opened}>
        <Stack gap={8}>{children}</Stack>
      </Collapse>
    </Stack>
  );
}

export const SharedFiltersSection = memo(SharedFiltersSectionComponent);
