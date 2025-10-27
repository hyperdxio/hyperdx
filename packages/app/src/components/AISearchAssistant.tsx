import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
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

import { InputControlled } from '@/components/InputControlled';
import { useSearchAssistant } from '@/hooks/ai';
import { useLocalStorage } from '@/utils';

export function AISearchAssistant({
  setWhere,
  sourceId,
  aiAssistantEnabled,
}: {
  setWhere: (where: string) => void;
  sourceId: string;
  aiAssistantEnabled: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [alertDismissed, setAlertDismissed] = useLocalStorage(
    'ai-search-assistant-alert-dismissed',
    false,
  );
  const { control, handleSubmit } = useForm<{
    text: string;
  }>({
    defaultValues: {
      text: '',
    },
  });

  const searchAssistant = useSearchAssistant();

  const onSubmit = (data: { text: string }) => {
    if (!sourceId) {
      notifications.show({
        color: 'red',
        title: 'No Source Selected',
        message: 'Please select a data source first',
        autoClose: 2000,
      });
      return;
    }

    searchAssistant.mutate(
      {
        sourceId: sourceId,
        text: data.text,
      },
      {
        onSuccess(responseData) {
          setWhere(responseData.where);

          notifications.show({
            color: 'green',
            message:
              responseData.explanation ||
              'Search filter generated successfully',
            autoClose: 3000,
          });
        },
        onError(err) {
          console.error('AI Search Assistant - Error:', err);
          notifications.show({
            color: 'red',
            title: 'Error Generating Search Filter',
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
          color="dark.3"
          icon={<i className="bi bi-info-circle" />}
          variant="outline"
          withCloseButton
          onClose={() => setAlertDismissed(true)}
          p="xxs"
        >
          <Text size="xs" c="dark.2" pt="2px">
            New AI Assistant available, enable by configuring the{' '}
            <code>ANTHROPIC_API_KEY</code> environment variable on the HyperDX
            server.
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
        <Button
          onClick={() => setOpened(o => !o)}
          size="xs"
          variant="subtle"
          color="gray"
        >
          <Group gap="xs">
            {opened ? (
              <i className="bi bi-chevron-up" />
            ) : (
              <i className="bi bi-chevron-down" />
            )}
            <Text size="xxs">AI Search Assistant [A]</Text>
          </Group>
        </Button>
        <Pill size="xs">Experimental</Pill>
      </Group>
      <Collapse in={opened}>
        {opened && (
          <Group mb="md">
            <Box style={{ flexGrow: 1, minWidth: 100 }}>
              <InputControlled
                autoFocus
                placeholder="ex. Show me errors from the frontend service"
                data-testid="ai-search-input"
                control={control}
                name="text"
                rules={{ required: true }}
                size="xs"
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(onSubmit)();
                  }
                }}
              />
            </Box>
            {searchAssistant.isPending ? (
              <Loader size="xs" type="dots" />
            ) : (
              <Button
                onClick={handleSubmit(onSubmit)}
                size="xs"
                variant="light"
              >
                Generate Filter
              </Button>
            )}
          </Group>
        )}
      </Collapse>
      <Divider />
    </Box>
  );
}
