import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatRelative } from 'date-fns';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconMessage,
  IconPencil,
  IconTrash,
  IconUser,
  IconSparkles,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/PageHeader';
import api from './api';
import {
  Incident,
  IncidentEvent,
  IncidentSeverity,
  IncidentStatus,
} from './types';

const STATUS_COLORS = {
  [IncidentStatus.OPEN]: 'red',
  [IncidentStatus.INVESTIGATING]: 'orange',
  [IncidentStatus.FIXED]: 'blue',
  [IncidentStatus.RESOLVED]: 'green',
  [IncidentStatus.CANCELLED]: 'gray',
};

const SEVERITY_COLORS = {
  [IncidentSeverity.CRITICAL]: 'red',
  [IncidentSeverity.HIGH]: 'orange',
  [IncidentSeverity.MEDIUM]: 'yellow',
  [IncidentSeverity.LOW]: 'blue',
};

function UpdateStatusModal({
  opened,
  onClose,
  incident,
}: {
  opened: boolean;
  onClose: () => void;
  incident: Incident;
}) {
  const updateIncident = api.useUpdateIncident();
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: {
      status: incident.status,
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      await updateIncident.mutateAsync({
        id: incident._id,
        status: values.status,
      });
      notifications.show({
        title: 'Success',
        message: 'Status updated successfully',
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['incidents', incident._id] });
      onClose();
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to update status',
        color: 'red',
      });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Update Status">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
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
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={updateIncident.isPending}>
              Update
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function AssignOwnerModal({
  opened,
  onClose,
  incident,
}: {
  opened: boolean;
  onClose: () => void;
  incident: Incident;
}) {
  const updateIncident = api.useUpdateIncident();
  const { data: teamMembersData } = api.useTeamMembers();
  const queryClient = useQueryClient();
  
  const teamMembers = teamMembersData?.data || [];

  const form = useForm({
    initialValues: {
      ownerId: incident.owner?._id || '',
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      await updateIncident.mutateAsync({
        id: incident._id,
        ownerId: values.ownerId,
      });
      notifications.show({
        title: 'Success',
        message: 'Owner assigned successfully',
        color: 'green',
      });
      queryClient.invalidateQueries({ queryKey: ['incidents', incident._id] });
      onClose();
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to assign owner',
        color: 'red',
      });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Assign Owner">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Select
            label="Owner"
            data={teamMembers.map((m: any) => ({
              value: m._id,
              label: m.name || m.email,
            }))}
            {...form.getInputProps('ownerId')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={updateIncident.isPending}>
              Assign
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function EditDetailsModal({
    opened,
    onClose,
    incident,
  }: {
    opened: boolean;
    onClose: () => void;
    incident: Incident;
  }) {
    const updateIncident = api.useUpdateIncident();
    const queryClient = useQueryClient();
    
    const form = useForm({
      initialValues: {
        title: incident.title,
        description: incident.description || '',
        severity: incident.severity,
        resolutionNotes: incident.resolutionNotes || '',
      },
      validate: {
        title: (value) => !value ? 'Title is required' : null,
      },
    });
  
    const handleSubmit = async (values: typeof form.values) => {
      try {
        await updateIncident.mutateAsync({
          id: incident._id,
          ...values,
        });
        notifications.show({
          title: 'Success',
          message: 'Incident updated successfully',
          color: 'green',
        });
        queryClient.invalidateQueries({ queryKey: ['incidents', incident._id] });
        onClose();
      } catch (error: any) {
        notifications.show({
          title: 'Error',
          message: error.message || 'Failed to update incident',
          color: 'red',
        });
      }
    };
  
    return (
      <Modal opened={opened} onClose={onClose} title="Edit Incident Details" size="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
                label="Title"
                required
                {...form.getInputProps('title')}
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
            <Textarea
              label="Description"
              minRows={3}
              {...form.getInputProps('description')}
            />
            <Textarea
                label="Resolution Notes / RCA"
                minRows={3}
                placeholder="What was the root cause? How was it fixed?"
                {...form.getInputProps('resolutionNotes')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={updateIncident.isPending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    );
  }

function TimelineItem({ event }: { event: IncidentEvent }) {
  const date = new Date(event.createdAt);
  
  let icon = <IconMessage size={12} />;
  let color = 'gray';
  let title = 'Comment';

  if (event.type === 'status_change') {
    icon = <IconCheck size={12} />;
    color = 'blue';
    title = 'Status Change';
  } else if (event.type === 'assignment') {
    icon = <IconUser size={12} />;
    color = 'teal';
    title = 'Assignment';
  }

  return (
    <Timeline.Item bullet={icon} title={title} color={color}>
      <Text c="dimmed" size="xs">
        {formatRelative(date, new Date())} by {event.author?.name || event.author?.email || 'Unknown'}
      </Text>
      <Text size="sm" mt={4}>
        {event.message}
      </Text>
    </Timeline.Item>
  );
}

export default function IncidentDetailsPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data, isLoading, error } = api.useIncident(id as string);
  const addComment = api.useAddIncidentComment();
  const analyzeIncident = api.useAnalyzeIncident();
  const queryClient = useQueryClient();

  const [statusModalOpen, { open: openStatusModal, close: closeStatusModal }] = useDisclosure(false);
  const [ownerModalOpen, { open: openOwnerModal, close: closeOwnerModal }] = useDisclosure(false);
  const [editModalOpen, { open: openEditModal, close: closeEditModal }] = useDisclosure(false);
  
  const [comment, setComment] = React.useState('');

  const incident = data?.data;

  const handleAnalyze = async () => {
    if (!incident) return;
    try {
      await analyzeIncident.mutateAsync(incident._id);
      queryClient.invalidateQueries({ queryKey: ['incidents', incident._id] });
      notifications.show({
        title: 'Analysis Started',
        message: 'AI analysis has been added to the timeline.',
        color: 'blue',
      });
    } catch (e: any) {
        notifications.show({
            title: 'Error',
            message: e.message || 'Failed to run analysis',
            color: 'red',
        });
    }
  };

  const handleAddComment = async () => {
    if (!comment.trim() || !incident) return;
    try {
      await addComment.mutateAsync({ id: incident._id, message: comment });
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['incidents', incident._id] });
      notifications.show({
        title: 'Success',
        message: 'Comment added',
        color: 'green',
      });
    } catch (e: any) {
        notifications.show({
            title: 'Error',
            message: e.message || 'Failed to add comment',
            color: 'red',
        });
    }
  };

  if (isLoading) return <Container><Text>Loading...</Text></Container>;
  if (error || !incident) return <Container><Text>Error loading incident</Text></Container>;

  return (
    <>
      <Head>
        <title>{incident.title} - HyperDX</title>
      </Head>
      <Container size="xl" py="md">
        <Group mb="md">
          <Link href="/incidents" passHref legacyBehavior>
            <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} component="a">
              Back to Incidents
            </Button>
          </Link>
        </Group>

        <Group justify="space-between" align="start" mb="xl">
            <div>
                <Title order={2}>{incident.title}</Title>
                {incident.alert && (
                    <Text c="dimmed" size="sm" mt={4}>
                        Triggered by alert: <Link href={`/alerts?id=${incident.alert._id}`}>{incident.alert.name}</Link>
                    </Text>
                )}
            </div>
            <Group>
                <Button 
                    variant="light" 
                    color="violet" 
                    leftSection={<IconSparkles size={16} />} 
                    onClick={handleAnalyze}
                    loading={analyzeIncident.isPending}
                >
                    Analyze
                </Button>
                <Button variant="default" leftSection={<IconPencil size={16} />} onClick={openEditModal}>
                    Edit Details
                </Button>
                {/* Add delete button potentially? */}
            </Group>
        </Group>

        <Grid gutter="xl">
          <Grid.Col span={8}>
            <Stack gap="xl">
              <Card withBorder padding="lg">
                <Title order={4} mb="md">Description</Title>
                <Text style={{ whiteSpace: 'pre-wrap' }}>{incident.description || 'No description provided.'}</Text>
              </Card>

              {incident.resolutionNotes && (
                  <Card withBorder padding="lg">
                    <Title order={4} mb="md">Resolution Notes / RCA</Title>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{incident.resolutionNotes}</Text>
                  </Card>
              )}

              <Card withBorder padding="lg">
                <Title order={4} mb="md">Timeline</Title>
                <Timeline active={incident.events.length} bulletSize={24} lineWidth={2}>
                  {incident.events.slice().reverse().map((event, i) => (
                    <TimelineItem key={i} event={event} />
                  ))}
                </Timeline>

                <Divider my="lg" />
                
                <Group align="start">
                    <Textarea 
                        placeholder="Add a comment..." 
                        style={{ flex: 1 }}
                        value={comment}
                        onChange={(e) => setComment(e.currentTarget.value)}
                        minRows={2}
                    />
                    <Button onClick={handleAddComment} loading={addComment.isPending}>
                        Comment
                    </Button>
                </Group>
              </Card>
            </Stack>
          </Grid.Col>

          <Grid.Col span={4}>
            <Stack gap="md">
              <Card withBorder padding="lg">
                <Title order={5} mb="md">Details</Title>
                
                <Stack gap="md">
                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Status</Text>
                        <Group mt={4}>
                            <Badge color={STATUS_COLORS[incident.status]} size="lg">
                                {incident.status}
                            </Badge>
                            <ActionIcon variant="subtle" color="gray" size="sm" onClick={openStatusModal}>
                                <IconPencil size={14} />
                            </ActionIcon>
                        </Group>
                    </div>

                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Severity</Text>
                        <Badge color={SEVERITY_COLORS[incident.severity]} mt={4}>
                            {incident.severity}
                        </Badge>
                    </div>

                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Owner</Text>
                        <Group mt={4} gap="xs">
                            <Avatar size="sm" radius="xl" />
                            <Text size="sm">
                                {incident.owner ? (incident.owner.name || incident.owner.email) : 'Unassigned'}
                            </Text>
                            <ActionIcon variant="subtle" color="gray" size="sm" onClick={openOwnerModal}>
                                <IconPencil size={14} />
                            </ActionIcon>
                        </Group>
                    </div>

                    <Divider />

                    <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Created</Text>
                        <Group gap={4} mt={4}>
                            <IconClock size={14} color="gray" />
                            <Text size="sm">{formatRelative(new Date(incident.createdAt), new Date())}</Text>
                        </Group>
                    </div>
                </Stack>
              </Card>
            </Stack>
          </Grid.Col>
        </Grid>
      </Container>

      <UpdateStatusModal opened={statusModalOpen} onClose={closeStatusModal} incident={incident} />
      <AssignOwnerModal opened={ownerModalOpen} onClose={closeOwnerModal} incident={incident} />
      <EditDetailsModal opened={editModalOpen} onClose={closeEditModal} incident={incident} />
    </>
  );
}

