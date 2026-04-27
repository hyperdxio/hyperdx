import { ReactNode, useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Drawer, Flex, Group, Text } from '@mantine/core';
import { IconConnection } from '@tabler/icons-react';

import DBTracePanel from '@/components/DBTracePanel';
import EmptyState from '@/components/EmptyState';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useSource } from '@/source';

interface DirectTraceSidePanelProps {
  opened: boolean;
  traceId: string;
  traceSourceId?: string | null;
  dateRange: [Date, Date];
  focusDate: Date;
  onClose: () => void;
  onSourceChange: (sourceId: string | null) => void;
}

export default function DirectTraceSidePanel({
  opened,
  traceId,
  traceSourceId,
  dateRange,
  focusDate,
  onClose,
  onSourceChange,
}: DirectTraceSidePanelProps) {
  const { control, setValue } = useForm<{ source: string | null }>({
    defaultValues: {
      source: traceSourceId ?? null,
    },
  });

  useEffect(() => {
    setValue('source', traceSourceId ?? null);
  }, [setValue, traceSourceId]);

  const selectedSourceId = useWatch({ control, name: 'source' });

  useEffect(() => {
    if ((selectedSourceId ?? null) !== (traceSourceId ?? null)) {
      onSourceChange(selectedSourceId ?? null);
    }
  }, [onSourceChange, selectedSourceId, traceSourceId]);

  const {
    data: traceSource,
    error: traceSourceError,
    isLoading: isTraceSourceLoading,
  } = useSource({
    id: selectedSourceId,
    kinds: [SourceKind.Trace],
  });

  const emptyState = useMemo<ReactNode>(() => {
    let title = 'Select a trace source';
    let description =
      'Choose a trace source to open this trace in the sidebar.';

    if (traceSourceError) {
      title = 'Unable to load trace source';
      description =
        'There was a problem loading the selected trace source. Try again or choose a different source.';
    } else if (selectedSourceId && isTraceSourceLoading) {
      title = 'Loading trace source';
      description = 'Resolving the selected trace source.';
    } else if (selectedSourceId && !traceSource) {
      title = 'Trace source not found';
      description =
        'The requested source could not be loaded. Choose another trace source to continue.';
    }

    return (
      <EmptyState
        icon={<IconConnection size={24} />}
        title={title}
        description={description}
        variant="card"
        fullWidth
        mt="md"
      />
    );
  }, [isTraceSourceLoading, selectedSourceId, traceSource, traceSourceError]);

  const shouldRenderTracePanel =
    opened && traceId.length > 0 && traceSource?.kind === SourceKind.Trace;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="75vw"
      title={
        <Group gap="xs">
          <IconConnection size={16} />
          <Text fw={600}>Trace</Text>
        </Group>
      }
      styles={{
        body: {
          height: '100%',
          overflowY: 'auto',
        },
      }}
    >
      <Flex justify="flex-end" mb="sm">
        <Group gap="sm" align="center">
          <Text size="sm">Trace Source</Text>
          <SourceSelectControlled
            control={control}
            name="source"
            size="xs"
            allowedSourceKinds={[SourceKind.Trace]}
          />
        </Group>
      </Flex>
      <Box h="100%">
        {opened ? (
          shouldRenderTracePanel ? (
            <DBTracePanel
              traceId={traceId}
              parentSourceId={traceSource.id}
              childSourceId={traceSource.logSourceId}
              dateRange={dateRange}
              focusDate={focusDate}
              emptyState={
                <EmptyState
                  icon={<IconConnection size={24} />}
                  title="Trace not found"
                  description="No matching spans or correlated logs were found for this trace in the selected source and time range."
                  variant="card"
                  fullWidth
                  mt="md"
                />
              }
            />
          ) : (
            emptyState
          )
        ) : null}
      </Box>
    </Drawer>
  );
}
