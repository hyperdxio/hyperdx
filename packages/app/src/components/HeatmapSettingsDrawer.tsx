import { useCallback, useEffect, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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

import SettingsSidePanel from './SettingsSidePanel';

const HeatmapSettingsSchema = z.object({
  value: z.string().trim().min(1),
  count: z.string().trim().optional(),
  scaleType: z.enum(['log', 'linear']).default('log'),
});

export type HeatmapSettingsValues = z.infer<typeof HeatmapSettingsSchema>;

export default function HeatmapSettingsDrawer({
  opened = false,
  onClose,
  connection,
  parentRef,
  defaultValues,
  onSubmit,
  asPanel = false,
  asRailSection = false,
}: {
  opened?: boolean;
  onClose?: () => void;
  connection: TableConnection;
  parentRef?: HTMLElement | null;
  defaultValues: HeatmapSettingsValues;
  onSubmit: (v: HeatmapSettingsValues) => void;
  /**
   * Render as an in-place full-height side panel (used inside the tile editor
   * drawer) instead of a nested Drawer overlay. Defaults to the Drawer so other
   * callers (e.g. the Search page heatmap) are unaffected.
   */
  asPanel?: boolean;
  /**
   * Render bare content (no Drawer/panel chrome) for embedding inside the
   * docked tile settings rail. In this mode edits write live to the tile draft
   * via `onSubmit` (debounced) and there is no Apply button — the tile's
   * Save/Cancel is the single commit point.
   */
  asRailSection?: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(HeatmapSettingsSchema),
    defaultValues,
  });

  // Reset only on the closed→open transition so every dismiss path — Apply,
  // Cancel, Esc, or a tab change that closes the panel via the bare disclosure —
  // behaves like cancel: abandoned edits never linger in the sub-form to be
  // written by the next Apply. This is edge-triggered on `opened` (via a ref)
  // rather than level-triggered on `defaultValues`: `defaultValues` is a
  // useMemo over watched value/count/scale in the parent, so a level-triggered
  // reset would re-run whenever the source (or any watched field) changes while
  // the panel is open, silently discarding unapplied panel edits. Kept in
  // lockstep with ChartDisplaySettingsDrawer's edge-triggered reset.
  const wasOpenedRef = useRef(false);
  useEffect(() => {
    if (opened && !wasOpenedRef.current) {
      form.reset(defaultValues);
    }
    wasOpenedRef.current = opened;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form object is stable from useForm
  }, [opened, defaultValues]);

  const handleClose = useCallback(() => {
    form.reset(defaultValues);
    onClose?.();
  }, [onClose, form, defaultValues]);

  const scaleType = useWatch({ control: form.control, name: 'scaleType' });

  // Rail mode autosave: write valid edits through to the tile draft on change
  // (debounced, and only once the user has actually edited something).
  // handleSubmit gates on the zod schema, so an empty Value is never pushed.
  const railValues = useWatch({ control: form.control });
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    if (!asRailSection || !isDirty) return;
    const handle = setTimeout(() => form.handleSubmit(onSubmit)(), 300);
    return () => clearTimeout(handle);
  }, [asRailSection, isDirty, railValues, form, onSubmit]);

  const content = (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Stack gap="md">
        <Box>
          <Text size="sm" fw={500} mb={4}>
            Scale
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

        {!asRailSection && (
          <>
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
          </>
        )}
      </Stack>
    </form>
  );

  // Rail mode: bare content embedded in the docked tile settings rail, which
  // supplies its own header/close. Edits write live via the autosave effect.
  if (asRailSection) {
    return content;
  }

  // Panel mode: dock as a full-height side panel beside the editor (used inside
  // the tile editor drawer) instead of stacking a second drawer.
  if (asPanel) {
    if (!opened) return null;
    return (
      <SettingsSidePanel
        title="Display Settings"
        onClose={handleClose}
        data-testid="heatmap-settings-panel"
      >
        {content}
      </SettingsSidePanel>
    );
  }

  return (
    <Drawer
      title="Display Settings"
      opened={opened}
      onClose={handleClose}
      position="right"
      size="sm"
      lockScroll={false}
    >
      {content}
    </Drawer>
  );
}
