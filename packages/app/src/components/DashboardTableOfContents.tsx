import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChevronRight, IconX } from '@tabler/icons-react';

export const dashboardSectionAnchorId = (containerId: string) =>
  `dashboard-section-${containerId}`;

export const DASHBOARD_TOC_SIDEBAR_WIDTH = 240;

type DashboardTableOfContentsProps = {
  containers: DashboardContainerSchema[];
  isContainerCollapsed: (container: DashboardContainerSchema) => boolean;
  /** Called when the user clicks a section entry in the TOC. */
  onNavigate: (containerId: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Called when the user clicks the close (×) button — hides the sidebar. */
  onClose: () => void;
};

/**
 * Sidebar navigator listing the sections (containers) on a dashboard.
 * - Renders as a vertical list of section entries; sticky-positioned by the
 *   parent layout so it stays in view while scrolling.
 * - Each row shows a chevron reflecting its section's current collapse state
 *   and triggers `onNavigate` (which expands + scrolls to the section).
 * - Header has a close button; footer has bulk expand/collapse controls.
 */
export default function DashboardTableOfContents({
  containers,
  isContainerCollapsed,
  onNavigate,
  onExpandAll,
  onCollapseAll,
  onClose,
}: DashboardTableOfContentsProps) {
  if (containers.length === 0) return null;

  const collapsibleContainers = containers.filter(c => c.collapsible !== false);
  const anyCollapsed = collapsibleContainers.some(c => isContainerCollapsed(c));
  const anyExpanded = collapsibleContainers.some(c => !isContainerCollapsed(c));
  const hasCollapsibleSections = collapsibleContainers.length > 0;

  return (
    <Paper
      withBorder
      w={DASHBOARD_TOC_SIDEBAR_WIDTH}
      data-testid="dashboard-toc"
      aria-label="Dashboard sections"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Flex
        align="center"
        justify="space-between"
        gap="xs"
        px="sm"
        py={6}
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <Group gap={6} wrap="nowrap" miw={0}>
          <Text size="sm" fw={500} truncate>
            Sections
          </Text>
          <Text size="xs" c="dimmed">
            ({containers.length})
          </Text>
        </Group>
        <Tooltip label="Hide table of contents" withArrow fz="xs" color="gray">
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
      <ScrollArea.Autosize mah="calc(100vh - 240px)" type="hover">
        <Stack
          gap={0}
          py={4}
          role="list"
          aria-label="Section list"
          data-testid="dashboard-toc-list"
        >
          {containers.map(container => {
            const collapsed = isContainerCollapsed(container);
            const label = container.tabs?.[0]?.title ?? container.title;
            return (
              <Button
                key={container.id}
                role="listitem"
                variant="subtle"
                size="compact-sm"
                fullWidth
                justify="flex-start"
                radius={0}
                onClick={() => onNavigate(container.id)}
                leftSection={
                  <IconChevronRight
                    size={12}
                    style={{
                      color: 'var(--color-text-muted)',
                      transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      transition: 'transform 150ms ease',
                    }}
                  />
                }
                styles={{
                  root: { paddingInline: 12, height: 28 },
                  label: { fontWeight: 400, flex: 1, minWidth: 0 },
                  inner: { justifyContent: 'flex-start' },
                }}
                data-testid={`dashboard-toc-item-${container.id}`}
              >
                <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {label}
                </Text>
              </Button>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
      {hasCollapsibleSections && (
        <Box
          px="xs"
          py={6}
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <Group gap={4} grow>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={onExpandAll}
              disabled={!anyCollapsed}
              data-testid="dashboard-toc-expand-all"
            >
              Expand all
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={onCollapseAll}
              disabled={!anyExpanded}
              data-testid="dashboard-toc-collapse-all"
            >
              Collapse all
            </Button>
          </Group>
        </Box>
      )}
    </Paper>
  );
}
