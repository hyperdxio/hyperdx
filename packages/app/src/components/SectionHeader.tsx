import { DashboardSection } from '@hyperdx/common-utils/dist/types';
import { Flex, Text } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';

export default function SectionHeader({
  section,
  tileCount,
  onToggle,
}: {
  section: DashboardSection;
  tileCount: number;
  onToggle: () => void;
}) {
  return (
    <Flex
      align="center"
      gap="xs"
      px="sm"
      py={4}
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={!section.collapsed}
      aria-label={`Toggle ${section.title} section`}
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid var(--mantine-color-dark-4)',
        userSelect: 'none',
      }}
      data-testid={`section-header-${section.id}`}
    >
      <IconChevronRight
        size={16}
        style={{
          transform: section.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          transition: 'transform 150ms ease',
          flexShrink: 0,
          color: 'var(--mantine-color-dimmed)',
        }}
      />
      <Text size="sm" fw={500}>
        {section.title}
      </Text>
      {section.collapsed && tileCount > 0 && (
        <Text size="xs" c="dimmed">
          ({tileCount} {tileCount === 1 ? 'tile' : 'tiles'})
        </Text>
      )}
    </Flex>
  );
}
