import React, { useState } from 'react';
import { ActionIcon, Button, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconEdit, IconSettings } from '@tabler/icons-react';
import { formatDistanceToNow } from 'date-fns';

import api from '@/api';
import { ServiceReadinessBadge } from '@/components/ServiceReadiness/ServiceReadinessBadge';
import { ServiceSettingsModal } from '@/components/ServiceReadiness/ServiceSettingsModal';
import { ReadinessDetailsModal } from '@/components/ServiceReadiness/ReadinessDetailsModal';
import { Service } from '@/types';

export function ServiceDirectoryTab() {
  const { data: services, isLoading, refetch } = api.useRegistryServices();
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [detailsService, setDetailsService] = useState<Service | null>(null);

  if (isLoading) {
    return <Text>Loading services...</Text>;
  }

  return (
    <div>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Service Name</Table.Th>
            <Table.Th>Readiness</Table.Th>
            <Table.Th>Tier</Table.Th>
            <Table.Th>Last Seen</Table.Th>
            <Table.Th>Owner</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {services?.map((service) => (
            <Table.Tr key={service._id}>
              <Table.Td>
                <Text fw={500}>{service.name}</Text>
                {service.description && (
                  <Text size="xs" c="dimmed">
                    {service.description}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <div style={{ cursor: 'pointer' }} onClick={() => setDetailsService(service)}>
                  <ServiceReadinessBadge readiness={service.readiness} />
                </div>
              </Table.Td>
              <Table.Td>
                <BadgeTier tier={service.tier} />
              </Table.Td>
              <Table.Td>
                {service.lastSeenAt
                  ? formatDistanceToNow(new Date(service.lastSeenAt), { addSuffix: true })
                  : 'Never'}
              </Table.Td>
              <Table.Td>{service.owner || <Text c="dimmed">Unassigned</Text>}</Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Tooltip label="Edit Settings">
                    <ActionIcon variant="light" onClick={() => setEditingService(service)}>
                      <IconSettings size={16} />
                    </ActionIcon>
                  </Tooltip>
                  {service.runbookUrl && (
                    <Button
                      component="a"
                      href={service.runbookUrl}
                      target="_blank"
                      variant="default"
                      size="xs"
                    >
                      Runbook
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {editingService && (
        <ServiceSettingsModal
          opened={!!editingService}
          onClose={() => setEditingService(null)}
          service={editingService}
          onSuccess={refetch}
        />
      )}

      {detailsService && (
        <ReadinessDetailsModal
          opened={!!detailsService}
          onClose={() => setDetailsService(null)}
          service={detailsService}
        />
      )}
    </div>
  );
}

const BadgeTier = ({ tier }: { tier?: string }) => {
  if (!tier) return null;
  const color =
    tier === 'critical'
      ? 'red'
      : tier === 'high'
      ? 'orange'
      : tier === 'medium'
      ? 'blue'
      : 'gray';
  return (
    <Text c={color} tt="capitalize" fw={500} size="sm">
      {tier}
    </Text>
  );
};

