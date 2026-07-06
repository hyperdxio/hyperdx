import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import { SavedChartConfig, SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Loader,
  Pill,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown,
  IconChevronUp,
  IconInfoCircle,
} from '@tabler/icons-react';

import { InputControlled } from '@/components/InputControlled';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useChartAssistant } from '@/hooks/ai';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { useLocalStorage } from '@/utils';

/**
 * Natural-language chart builder. Extracted from the former standalone Chart
 * Explorer page so it can be embedded in the unified Explore page's chart mode.
 */
export default function ChartExplorerAIAssistant({
  setConfig,
  onTimeRangeSelect,
  submitRef,
  aiAssistantEnabled,
}: {
  setConfig: (config: SavedChartConfig) => void;
  onTimeRangeSelect: (start: Date, end: Date) => void;
  submitRef: React.RefObject<(() => void) | undefined>;
  aiAssistantEnabled: boolean;
}) {
  const brandName = useBrandDisplayName();
  const [opened, setOpened] = useState(false);
  const [alertDismissed, setAlertDismissed] = useLocalStorage(
    'ai-assistant-alert-dismissed',
    false,
  );
  const { control, handleSubmit } = useForm<{
    text: string;
    source: string;
  }>({
    defaultValues: {
      text: '',
      source: '',
    },
  });

  const chartAssistant = useChartAssistant();

  const onSubmit = (data: { text: string; source: string }) => {
    chartAssistant.mutate(
      {
        sourceId: data.source,
        text: data.text,
      },
      {
        onSuccess(data) {
          setConfig({ ...data, where: '' });
          onTimeRangeSelect(
            new Date(data.dateRange[0]),
            new Date(data.dateRange[1]),
          );

          // FIXME: This is a hack to submit after the form has been updated
          setTimeout(() => {
            if (submitRef.current) {
              submitRef.current();
            }
          }, 100);

          notifications.show({
            color: 'green',
            message: 'Chart generated successfully',
            autoClose: 2000,
          });
        },
        onError(err) {
          notifications.show({
            color: 'red',
            title: 'Error Generating Chart',
            message: err.message,
            autoClose: 2000,
          });
        },
      },
    );
  };

  useHotkeys(
    'a',
    () => {
      setOpened(v => !v);
    },
    {
      preventDefault: true,
    },
  );

  if (!aiAssistantEnabled && !alertDismissed) {
    return (
      <Box mb="sm">
        <Alert
          color="dark"
          icon={<IconInfoCircle size={16} />}
          variant="outline"
          withCloseButton
          onClose={() => setAlertDismissed(true)}
          p="xxs"
        >
          <Text size="xs" pt="2px">
            New AI Assistant available, enable with configuring the{' '}
            <code>ANTHROPIC_API_KEY</code> environment variable on the{' '}
            {brandName} server.
          </Text>
        </Alert>
        <Divider mt="sm" />
      </Box>
    );
  } else if (!aiAssistantEnabled) {
    return null;
  }

  return (
    <Box mb="sm">
      <Group gap="md" align="center" mb="sm">
        <Button onClick={() => setOpened(o => !o)} size="xs" variant="subtle">
          <Group gap="xs">
            {opened ? (
              <IconChevronUp size={14} />
            ) : (
              <IconChevronDown size={14} />
            )}
            <Text size="xxs">AI Assistant [A]</Text>
          </Group>
        </Button>
        <Pill size="xs">Experimental</Pill>
      </Group>
      <Collapse expanded={opened}>
        {opened && (
          // eslint-disable-next-line react-hooks/refs
          <form onSubmit={handleSubmit(onSubmit)}>
            <Group mb="md">
              <SourceSelectControlled
                autoFocus
                size="xs"
                control={control}
                name="source"
                data-testid="source-selector"
                allowedSourceKinds={[SourceKind.Log, SourceKind.Trace]}
              />
              <Box style={{ flexGrow: 1, minWidth: 100 }}>
                <InputControlled
                  placeholder="ex. Error counts by service over last 2 hours"
                  data-testid="save-search-name-input"
                  control={control}
                  name="text"
                  rules={{ required: true }}
                  size="xs"
                />
              </Box>
              {chartAssistant.isPending ? (
                <Loader size="xs" type="dots" />
              ) : (
                <Button type="submit" size="xs" variant="primary">
                  Generate
                </Button>
              )}
            </Group>
          </form>
        )}
      </Collapse>
      <Divider />
    </Box>
  );
}
