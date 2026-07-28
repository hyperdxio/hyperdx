import { useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

const HeatmapSettingsSchema = z.object({
  value: z.string().trim().min(1),
  count: z.string().trim().optional(),
  scaleType: z.enum(['log', 'linear']).default('log'),
});

export type HeatmapSettingsValues = z.infer<typeof HeatmapSettingsSchema>;

export default function HeatmapSettingsDrawer({
  opened,
  onClose,
  connection,
  parentRef,
  defaultValues,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  connection: TableConnection;
  parentRef?: HTMLElement | null;
  defaultValues: HeatmapSettingsValues;
  onSubmit: (v: HeatmapSettingsValues) => void;
}) {
  const { t } = useTranslation('charts');
  const form = useForm({
    resolver: zodResolver(HeatmapSettingsSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form object is stable from useForm
  }, [defaultValues]);

  const handleClose = useCallback(() => {
    form.reset(defaultValues);
    onClose();
  }, [onClose, form, defaultValues]);

  const scaleType = useWatch({ control: form.control, name: 'scaleType' });

  return (
    <Drawer
      title={t('common.displaySettings')}
      opened={opened}
      onClose={handleClose}
      position="right"
      size="sm"
      lockScroll={false}
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={500} mb={4}>
              {t('heatmap.scale')}
            </Text>
            <SegmentedControl
              size="xs"
              value={scaleType}
              onChange={v => {
                if (v === 'log' || v === 'linear') {
                  form.setValue('scaleType', v);
                }
              }}
              data={[
                { label: t('heatmap.scaleLog'), value: 'log' },
                { label: t('heatmap.scaleLinear'), value: 'linear' },
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
            placeholder={t('heatmap.sqlExpressionPlaceholder')}
            language="sql"
            onSubmit={form.handleSubmit(onSubmit)}
            label={t('heatmap.value')}
            error={form.formState.errors.value?.message}
            rules={{ required: true }}
          />

          <SQLInlineEditorControlled
            parentRef={parentRef}
            tableConnection={connection}
            control={form.control}
            name="count"
            placeholder={t('heatmap.sqlExpressionPlaceholder')}
            language="sql"
            size="xs"
            tooltipText="Controls the color intensity (Z axis) — shows how frequently or strongly each value occurs."
            onSubmit={form.handleSubmit(onSubmit)}
            label={t('heatmap.count')}
            error={form.formState.errors.count?.message}
          />

          <Divider />
          <Group gap="xs" justify="flex-end">
            <Button variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              leftSection={<IconPlayerPlay size={16} />}
            >
              {t('common.apply')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
