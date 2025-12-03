import React from 'react';
import { useForm } from 'react-hook-form';
import { Button, Modal, Select, Stack, TextInput } from '@mantine/core';

import api from '@/api';
import { Service, ServiceTier } from '@/types';
import { notifications } from '@mantine/notifications';

interface ServiceSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  service: Service;
  onSuccess?: () => void;
}

export const ServiceSettingsModal = ({ opened, onClose, service, onSuccess }: ServiceSettingsModalProps) => {
  const { mutate: updateService, isPending } = api.useUpdateService();
  
  const { register, handleSubmit, setValue, watch } = useForm({
    defaultValues: {
      description: service.description || '',
      tier: service.tier || ServiceTier.MEDIUM,
      runbookUrl: service.runbookUrl || '',
      repoUrl: service.repoUrl || '',
      owner: service.owner || '',
    },
  });

  const onSubmit = (data: any) => {
    updateService(
      { name: service.name, ...data },
      {
        onSuccess: () => {
          notifications.show({
            title: 'Success',
            message: 'Service settings updated',
            color: 'green',
          });
          onSuccess?.();
          onClose();
        },
        onError: (err) => {
            notifications.show({
                title: 'Error',
                message: err.message,
                color: 'red',
            });
        }
      }
    );
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Settings: ${service.name}`} size="lg">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack gap="md">
          <Select
            label="Tier"
            data={[
              { value: ServiceTier.CRITICAL, label: 'Critical' },
              { value: ServiceTier.HIGH, label: 'High' },
              { value: ServiceTier.MEDIUM, label: 'Medium' },
              { value: ServiceTier.LOW, label: 'Low' },
            ]}
            value={watch('tier')}
            onChange={(val) => setValue('tier', val as ServiceTier)}
          />

          <TextInput
            label="Description"
            placeholder="Service description"
            {...register('description')}
          />

          <TextInput
            label="Runbook URL"
            placeholder="https://..."
            {...register('runbookUrl')}
          />

          <TextInput
            label="Repository URL"
            placeholder="https://github.com/..."
            {...register('repoUrl')}
          />
          
          {/* TODO: Add Owner Selector using Team Members */}

          <Button type="submit" loading={isPending} fullWidth>
            Save Changes
          </Button>
        </Stack>
      </form>
    </Modal>
  );
};

