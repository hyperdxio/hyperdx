import * as React from 'react';
import Head from 'next/head';
import { formatRelative } from 'date-fns';
import Link from 'next/link';
import {
  Badge,
  Button,
  Container,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconPencil } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/PageHeader';
import api from './api';
import { Incident, IncidentSeverity, IncidentStatus } from './types';

function IncidentForm({
  incident,
  onClose,
  onSuccess,
}: {
  incident?: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const createIncident = api.useCreateIncident();
  const updateIncident = api.useUpdateIncident();
  const { data: teamMembersData } = api.useTeamMembers();
  const teamMembers = teamMembersData?.data || [];

  const form = useForm({
    initialValues: {
      title: incident?.title || '',
      description: incident?.description || '',
      status: incident?.status || IncidentStatus.OPEN,
      severity: incident?.severity || IncidentSeverity.LOW,
      ownerId: incident?.owner?._id || '',
    },
    validate: {
      title: value => (!value ? 'Title is required' : null),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const payload: any = {
        title: values.title,
        description: values.description,
        status: values.status,
        severity: values.severity,
        ownerId: values.ownerId || undefined,
      };

      if (incident) {
        await updateIncident.mutateAsync({ id: incident._id, ...payload });
        notifications.show({
          title: 'Success',
          message: 'Incident updated successfully',
          color: 'green',
        });
      } else {
        await createIncident.mutateAsync(payload);
        notifications.show({
          title: 'Success',
          message: 'Incident created successfully',
          color: 'green',
        });
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to save incident',
        color: 'red',
      });
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="md">
        <TextInput
          label="Title"
          placeholder="Incident Title"
          required
          {...form.getInputProps('title')}
        />
        <Textarea
          label="Description"
          placeholder="Describe the incident..."
          minRows={3}
          {...form.getInputProps('description')}
        />
        <Group grow>
          <Select
            label="Status"
            data={[
              { value: IncidentStatus.OPEN, label: 'Open' },
              { value: IncidentStatus.INVESTIGATING, label: 'Investigating' },
              { value: IncidentStatus.FIXED, label: 'Fixed' },
              { value: IncidentStatus.RESOLVED, label: 'Resolved' },
              { value: IncidentStatus.CANCELLED, label: 'Cancelled' },
            ]}
            {...form.getInputProps('status')}
          />
          <Select
            label="Severity"
            data={[
              { value: IncidentSeverity.CRITICAL, label: 'Critical' },
              { value: IncidentSeverity.HIGH, label: 'High' },
              { value: IncidentSeverity.MEDIUM, label: 'Medium' },
              { value: IncidentSeverity.LOW, label: 'Low' },
            ]}
            {...form.getInputProps('severity')}
          />
        </Group>
        <Select
          label="Owner"
          placeholder="Assign to..."
          data={teamMembers.map((member: any) => ({
            value: member._id,
            label: member.name || member.email,
          }))}
          {...form.getInputProps('ownerId')}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={createIncident.isPending || updateIncident.isPending}
          >
            {incident ? 'Update' : 'Create'} Incident
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const queryClient = useQueryClient();
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(
    false,
  );

  const statusColor = {
    [IncidentStatus.OPEN]: 'red',
    [IncidentStatus.INVESTIGATING]: 'orange',
    [IncidentStatus.FIXED]: 'blue',
    [IncidentStatus.RESOLVED]: 'green',
    [IncidentStatus.CANCELLED]: 'gray',
  }[incident.status];

  const severityColor = {
    [IncidentSeverity.CRITICAL]: 'red',
    [IncidentSeverity.HIGH]: 'orange',
    [IncidentSeverity.MEDIUM]: 'yellow',
    [IncidentSeverity.LOW]: 'blue',
  }[incident.severity];

  const lastUpdated = formatRelative(
    new Date(incident.updatedAt),
    new Date(),
  );

  return (
    <>
      <Table.Tr>
        <Table.Td>
          <Link href={`/incidents/${incident._id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div>
              <Text fw={500} c="blue">{incident.title}</Text>
              {incident.alert && (
                <Text size="xs" c="dimmed">
                  From Alert: {incident.alert.name}
                </Text>
              )}
            </div>
          </Link>
        </Table.Td>
        <Table.Td>
          <Badge color={statusColor}>{incident.status}</Badge>
        </Table.Td>
        <Table.Td>
          <Badge color={severityColor} variant="outline">
            {incident.severity}
          </Badge>
        </Table.Td>
        <Table.Td>
          <Text size="sm">
            {incident.owner ? incident.owner.name || incident.owner.email : '-'}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{lastUpdated}</Text>
        </Table.Td>
        <Table.Td>
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              color="blue"
              onClick={openEdit}
              title="Edit"
            >
              <IconPencil size={16} />
            </ActionIcon>
          </Group>
        </Table.Td>
      </Table.Tr>
      <Modal
        opened={editOpened}
        onClose={closeEdit}
        title="Edit Incident"
        size="lg"
      >
        <IncidentForm
          incident={incident}
          onClose={closeEdit}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
          }}
        />
      </Modal>
    </>
  );
}

function IncidentsPage() {
  const { data: incidentsData, isLoading } = api.useIncidents();
  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const queryClient = useQueryClient();

  const incidents: Incident[] = incidentsData?.data || [];

  return (
    <>
      <Head>
        <title>Incidents - HyperDX</title>
      </Head>
      <div className="IncidentsPage">
        <PageHeader>Incidents</PageHeader>
        <Container size="xl" py="md">
          <Group justify="space-between" mb="md">
            <Text size="sm" c="dimmed">
              {incidents.length} incident{incidents.length !== 1 ? 's' : ''}
            </Text>
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              Create Incident
            </Button>
          </Group>

          {isLoading ? (
            <Text>Loading...</Text>
          ) : incidents.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              No incidents yet. Create one to get started!
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Severity</Table.Th>
                  <Table.Th>Owner</Table.Th>
                  <Table.Th>Last Updated</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {incidents.map(incident => (
                  <IncidentRow key={incident._id} incident={incident} />
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Container>
      </div>

      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Incident"
        size="lg"
      >
        <IncidentForm
          onClose={closeCreate}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
          }}
        />
      </Modal>
    </>
  );
}

export default IncidentsPage;
