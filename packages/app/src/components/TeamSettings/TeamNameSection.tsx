import { useCallback, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import {
  Box,
  Button,
  Card,
  Divider,
  Group,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPencil } from '@tabler/icons-react';

import api from '@/api';

export default function TeamNameSection() {
  const { data: team, refetch: refetchTeam } = api.useTeam();
  const setTeamName = api.useSetTeamName();
  const hasAdminAccess = true;
  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const form = useForm<{ name: string }>({
    defaultValues: {
      name: team?.name,
    },
  });

  const onSubmit: SubmitHandler<{ name: string }> = useCallback(
    async values => {
      setTeamName.mutate(
        { name: values.name },
        {
          onError: _e => {
            notifications.show({
              color: 'red',
              message: 'Failed to update team name',
            });
          },
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Updated team name',
            });
            refetchTeam();
            setIsEditingTeamName(false);
          },
        },
      );
    },
    [refetchTeam, setTeamName],
  );

  return (
    <Box id="team_name" data-testid="team-name-section">
      <Text size="md">Team Name</Text>
      <Divider my="md" />
      <Card>
        {isEditingTeamName ? (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Group gap="xs">
              <TextInput
                data-testid="team-name-input"
                size="xs"
                placeholder="My Team"
                required
                error={form.formState.errors.name?.message}
                {...form.register('name', { required: true })}
                miw={300}
                min={1}
                max={100}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsEditingTeamName(false);
                  }
                }}
              />
              <Button
                data-testid="team-name-save-button"
                type="submit"
                size="xs"
                variant="primary"
                loading={setTeamName.isPending}
              >
                Save
              </Button>
              <Button
                data-testid="team-name-cancel-button"
                type="button"
                size="xs"
                variant="secondary"
                disabled={setTeamName.isPending}
                onClick={() => setIsEditingTeamName(false)}
              >
                Cancel
              </Button>
            </Group>
          </form>
        ) : (
          <Group gap="lg">
            <div className="fs-7" data-testid="team-name-display">
              {team?.name}
            </div>
            {hasAdminAccess && (
              <Button
                data-testid="team-name-change-button"
                size="xs"
                variant="secondary"
                leftSection={<IconPencil size={16} />}
                onClick={() => {
                  setIsEditingTeamName(true);
                }}
              >
                Change
              </Button>
            )}
          </Group>
        )}
      </Card>
    </Box>
  );
}
