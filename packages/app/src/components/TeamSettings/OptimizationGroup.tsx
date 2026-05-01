import { useMemo } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown,
  IconChevronRight,
  IconClipboard,
  IconPlayerTrackNextFilled,
  IconRotate,
  IconX,
} from '@tabler/icons-react';

import { SQLPreview } from '@/components/ChartSQLPreview';
import { useOptimizationDismissals } from '@/optimizations/dismissals';
import { OptimizationFinding, OptimizationPlugin } from '@/optimizations/types';
import { joinDDL, useApplyDDL } from '@/optimizations/useApplyDDL';

export type GroupItem = {
  plugin: OptimizationPlugin<any>;
  finding: OptimizationFinding<unknown>;
};

function CollapsibleFinding({
  plugin,
  finding,
  source,
  onDismiss,
}: {
  plugin: OptimizationPlugin<any>;
  finding: OptimizationFinding<unknown>;
  source: TSource | undefined;
  onDismiss: () => void;
}) {
  const [opened, { toggle }] = useDisclosure(false);

  const statements = useMemo(() => {
    if (!plugin.buildDDL || !source) return undefined;
    try {
      return plugin.buildDDL(finding, source);
    } catch {
      return undefined;
    }
  }, [plugin, finding, source]);
  const copyText = useMemo(
    () => (statements ? joinDDL(statements) : undefined),
    [statements],
  );

  const apply = useApplyDDL(source);

  const handleApply = () => {
    if (!statements) return;
    apply.mutate(
      { statements },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: `${plugin.title}: applied`,
          });
        },
        onError: error => {
          notifications.show({
            color: 'red',
            title: 'Failed to apply DDL',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  };

  return (
    <Card withBorder p="xs">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group
            gap="xs"
            wrap="nowrap"
            onClick={toggle}
            style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
            role="button"
            aria-expanded={opened}
          >
            {opened ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
            <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
              {finding.summary}
            </Text>
          </Group>
          <Tooltip label="Dismiss this recommendation">
            <ActionIcon
              variant="subtle"
              aria-label="Dismiss"
              onClick={e => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Collapse expanded={opened}>
          <Stack gap="sm" pt="xs">
            {plugin.renderFinding({ finding, source })}

            {copyText && (
              <SQLPreview
                data={copyText}
                formatData={false}
                enableLineWrapping
              />
            )}

            {copyText && (
              <Group gap="xs" justify="end">
                <CopyToClipboard
                  text={copyText}
                  onCopy={() =>
                    notifications.show({
                      color: 'green',
                      message: 'DDL snippet copied',
                    })
                  }
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    leftSection={<IconClipboard size={14} />}
                  >
                    Copy DDL
                  </Button>
                </CopyToClipboard>
                <Button
                  variant="primary"
                  size="xs"
                  leftSection={<IconPlayerTrackNextFilled size={14} />}
                  loading={apply.isPending}
                  onClick={handleApply}
                >
                  Apply
                </Button>
              </Group>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}

function DismissedRow({
  finding,
  onUndismiss,
}: {
  finding: OptimizationFinding<unknown>;
  onUndismiss: () => void;
}) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c="dimmed" style={{ flex: 1 }}>
        {finding.summary}
      </Text>
      <Button
        variant="subtle"
        size="xs"
        leftSection={<IconRotate size={14} />}
        onClick={onUndismiss}
      >
        Undismiss
      </Button>
    </Group>
  );
}

/**
 * A group of optimization findings under a single header. When `source` is
 * provided, it's threaded into every child for DDL building and applies.
 * When omitted, findings in the group are informational-only (no Apply path).
 */
export default function OptimizationGroup({
  title,
  subtitle,
  kindLabel,
  source,
  active,
  dismissed,
}: {
  title: string;
  subtitle?: string;
  kindLabel?: string;
  source?: TSource;
  active: GroupItem[];
  dismissed: GroupItem[];
}) {
  const { dismiss, undismiss } = useOptimizationDismissals();

  if (active.length === 0 && dismissed.length === 0) return null;

  return (
    <Box>
      <Group gap="xs" align="baseline" mb="xs">
        <Text size="sm" fw={500}>
          {title}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        )}
        {kindLabel && (
          <Badge variant="light" color="gray" size="xs">
            {kindLabel}
          </Badge>
        )}
      </Group>
      <Stack gap="xs">
        {active.map(({ plugin, finding }) => (
          <CollapsibleFinding
            key={`${plugin.id}::${finding.scopeId}`}
            plugin={plugin}
            finding={finding}
            source={source}
            onDismiss={() => dismiss(plugin.id, finding.scopeId)}
          />
        ))}

        {dismissed.length > 0 && (
          <Accordion variant="contained" chevronPosition="left">
            <Accordion.Item value="dismissed">
              <Accordion.Control>
                <Group gap="xs">
                  <Text size="sm">Dismissed</Text>
                  <Badge variant="light" color="gray">
                    {dismissed.length}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {dismissed.map(({ plugin, finding }) => (
                    <DismissedRow
                      key={`${plugin.id}::${finding.scopeId}`}
                      finding={finding}
                      onUndismiss={() => undismiss(plugin.id, finding.scopeId)}
                    />
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Stack>
    </Box>
  );
}
