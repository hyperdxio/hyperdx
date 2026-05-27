import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Collapse,
  Flex,
  Group,
  Paper,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronRight, IconLayoutList } from '@tabler/icons-react';

export const dashboardSectionAnchorId = (containerId: string) =>
  `dashboard-section-${containerId}`;

type DashboardTableOfContentsProps = {
  containers: DashboardContainerSchema[];
  isContainerCollapsed: (container: DashboardContainerSchema) => boolean;
  /** Called when the user clicks a section entry in the TOC. */
  onNavigate: (containerId: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

/**
 * Compact navigator listing the sections (containers) on a dashboard.
 * Each entry links to its section; "Expand all" / "Collapse all" act on
 * every section's per-viewer collapse state at once.
 */
export default function DashboardTableOfContents({
  containers,
  isContainerCollapsed,
  onNavigate,
  onExpandAll,
  onCollapseAll,
}: DashboardTableOfContentsProps) {
  const [opened, { toggle }] = useDisclosure(true);

  if (containers.length === 0) return null;

  const collapsibleContainers = containers.filter(c => c.collapsible !== false);
  const anyCollapsed = collapsibleContainers.some(c => isContainerCollapsed(c));
  const anyExpanded = collapsibleContainers.some(c => !isContainerCollapsed(c));
  const hasCollapsibleSections = collapsibleContainers.length > 0;

  return (
    <Paper withBorder mt="sm" px="sm" py={6} data-testid="dashboard-toc">
      <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
        <Flex
          align="center"
          gap={6}
          role="button"
          tabIndex={0}
          aria-expanded={opened}
          onClick={toggle}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          style={{ cursor: 'pointer', flexShrink: 0 }}
          data-testid="dashboard-toc-toggle"
        >
          <IconChevronRight
            size={14}
            style={{
              transform: opened ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
              color: 'var(--color-text-muted)',
            }}
          />
          <IconLayoutList
            size={14}
            style={{ color: 'var(--color-text-muted)' }}
          />
          <Text size="sm" fw={500}>
            Sections
          </Text>
          <Text size="xs" c="dimmed">
            ({containers.length})
          </Text>
        </Flex>
        {hasCollapsibleSections && (
          <Group gap={4}>
            <Tooltip label="Expand all sections" withArrow>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={onExpandAll}
                disabled={!anyCollapsed}
                data-testid="dashboard-toc-expand-all"
              >
                Expand all
              </Button>
            </Tooltip>
            <Tooltip label="Collapse all sections" withArrow>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={onCollapseAll}
                disabled={!anyExpanded}
                data-testid="dashboard-toc-collapse-all"
              >
                Collapse all
              </Button>
            </Tooltip>
          </Group>
        )}
      </Flex>
      <Collapse expanded={opened}>
        <Flex
          mt={6}
          gap={6}
          wrap="wrap"
          role="list"
          aria-label="Dashboard sections"
          data-testid="dashboard-toc-list"
        >
          {containers.map(container => {
            const collapsed = isContainerCollapsed(container);
            const label = container.tabs?.[0]?.title ?? container.title;
            return (
              <Box key={container.id} role="listitem">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => onNavigate(container.id)}
                  leftSection={
                    <IconChevronRight
                      size={12}
                      style={{
                        transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 150ms ease',
                      }}
                    />
                  }
                  styles={{ label: { fontWeight: 400 } }}
                  data-testid={`dashboard-toc-item-${container.id}`}
                >
                  {label}
                </Button>
              </Box>
            );
          })}
        </Flex>
      </Collapse>
    </Paper>
  );
}
