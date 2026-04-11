import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import type { HeatmapScaleType } from '@/components/DBHeatmapChart';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

export const HeatmapSettingsSchema = z.object({
  value: z.string().trim().min(1),
  count: z.string().trim().optional(),
});

export type HeatmapSettingsValues = z.infer<typeof HeatmapSettingsSchema>;

export default function HeatmapSettingsDrawer({
  opened,
  onClose,
  connection,
  parentRef,
  defaultValues,
  scaleType,
  onScaleTypeChange,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  connection: TableConnection;
  parentRef?: HTMLElement | null;
  defaultValues: HeatmapSettingsValues;
  scaleType: HeatmapScaleType;
  onScaleTypeChange: (v: HeatmapScaleType) => void;
  onSubmit: (v: HeatmapSettingsValues) => void;
}) {
  const form = useForm({
    resolver: zodResolver(HeatmapSettingsSchema),
    defaultValues,
  });

  const handleClose = useCallback(() => {
    form.reset(defaultValues);
    onClose();
  }, [onClose, form, defaultValues]);

  return (
    <Drawer
      title="Heatmap Settings"
      opened={opened}
      onClose={handleClose}
      position="right"
      size="sm"
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Scale
            </Text>
            <SegmentedControl
              size="xs"
              value={scaleType}
              onChange={v => onScaleTypeChange(v as HeatmapScaleType)}
              data={[
                { label: 'Log', value: 'log' },
                { label: 'Linear', value: 'linear' },
              ]}
            />
          </Box>

          <Divider />

          <SQLInlineEditorControlled
            parentRef={parentRef}
            tableConnection={connection}
            control={form.control}
            name="value"
            size="xs"
            tooltipText="Controls the Y axis range and scale — defines the metric plotted vertically."
            placeholder="SQL expression"
            language="sql"
            onSubmit={form.handleSubmit(onSubmit)}
            label="Value"
            error={form.formState.errors.value?.message}
            rules={{ required: true }}
          />

          <SQLInlineEditorControlled
            parentRef={parentRef}
            tableConnection={connection}
            control={form.control}
            name="count"
            placeholder="SQL expression"
            language="sql"
            size="xs"
            tooltipText="Controls the color intensity (Z axis) — shows how frequently or strongly each value occurs."
            onSubmit={form.handleSubmit(onSubmit)}
            label="Count"
            error={form.formState.errors.count?.message}
          />

          <Divider />
          <Group gap="xs" justify="flex-end">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              leftSection={<IconPlayerPlay size={16} />}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
