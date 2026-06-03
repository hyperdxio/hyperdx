import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Flex,
  NavLink,
  ScrollArea,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChevronRight, IconX } from '@tabler/icons-react';

export const TOC_CONTAINER_ANCHOR_ID = (containerId: string) =>
  `dashboard-container-${containerId}`;

type DashboardTableOfContentsProps = {
  containers: DashboardContainerSchema[];
  isCollapsed: (container: DashboardContainerSchema) => boolean;
  onToggleCollapse: (containerId: string) => void;
  onClose: () => void;
};

export default function DashboardTableOfContents({
  containers,
  isCollapsed,
  onToggleCollapse,
  onClose,
}: DashboardTableOfContentsProps) {
  if (containers.length === 0) return null;

  const handleJumpTo = (container: DashboardContainerSchema) => {
    const collapsible = container.collapsible !== false;
    const wasCollapsed = collapsible && isCollapsed(container);
    if (wasCollapsed) {
      onToggleCollapse(container.id);
    }
    // Defer scroll so the section has a chance to render expanded first.
    requestAnimationFrame(() => {
      document
        .getElementById(TOC_CONTAINER_ANCHOR_ID(container.id))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <Box
      component="nav"
      aria-label="Table of contents"
      data-testid="dashboard-toc"
      style={{
        width: 240,
        flexShrink: 0,
        position: 'sticky',
        top: 'var(--mantine-spacing-sm)',
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - var(--mantine-spacing-sm) * 2)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--mantine-color-body)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        px="sm"
        py={6}
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Text size="sm" fw={500}>
          Sections
        </Text>
        <Tooltip label="Hide table of contents" position="left" withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onClose}
            aria-label="Hide table of contents"
            data-testid="dashboard-toc-close"
          >
            <IconX size={14} />
          </ActionIcon>
        </Tooltip>
      </Flex>
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Box py={4}>
          {containers.map(container => {
            const tabs = container.tabs ?? [];
            const firstTab = tabs[0];
            const label = firstTab?.title ?? container.title;
            const collapsible = container.collapsible !== false;
            const collapsed = collapsible && isCollapsed(container);
            return (
              <NavLink
                key={container.id}
                onClick={() => handleJumpTo(container)}
                data-testid={`dashboard-toc-item-${container.id}`}
                opened={false}
                styles={{
                  root: {
                    padding: '4px 12px',
                    opacity: collapsed ? 0.55 : 1,
                  },
                  label: { fontSize: 'var(--mantine-font-size-sm)' },
                }}
                leftSection={
                  collapsible ? (
                    <IconChevronRight
                      size={12}
                      style={{
                        color: 'var(--color-text-muted)',
                        transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 150ms ease',
                      }}
                    />
                  ) : (
                    <Box w={12} />
                  )
                }
                label={
                  <Text size="sm" truncate>
                    {label}
                  </Text>
                }
              />
            );
          })}
        </Box>
      </ScrollArea>
    </Box>
  );
}
