import { useState } from 'react';
import { Button, Group, Modal, Stack, Table, Text } from '@mantine/core';

import { useHealthCheck } from '@/hooks/useMetadata';

// Modal which will run health checks and display a popup if the user
// has incorrect access permissions to the database.
export const HealthCheckModal = () => {
  const { results, refetch, isLoading } = useHealthCheck();
  const [forceClosed, setForceClosed] = useState(false);

  const unhealthyResults = results.filter(r => r && r.isAccessError);
  const hasUnhealthy = unhealthyResults.length > 0;

  if (isLoading) {
    return null;
  }

  return (
    <Modal
      opened={hasUnhealthy && !forceClosed}
      centered
      withCloseButton={false}
      onClose={() => {
        // If the user wants to, let them close and try.
        // They can also use this to switch teams
        setForceClosed(true);
      }}
    >
      <Stack gap="xs">
        <Text size="lg">Issues Connecting to Sources</Text>
        <Text size="sm" opacity={0.7} component="div">
          <p>
            It appears that we were unable to access some of the sources you
            provided.
          </p>
          <p style={{ margin: 0 }}>
            Please ensure that the database is accessible and you have the
            correct permissions before retrying.
          </p>
        </Text>

        <Table display="block" style={{ overflowX: 'auto' }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Source</Table.Th>
              <Table.Th>Details</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {unhealthyResults.map(element => (
              <Table.Tr key={element!.id}>
                <Table.Td>{element!.name}</Table.Td>
                <Table.Td>
                  {element!.error &&
                    'message' in element!.error &&
                    element!.error.message}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="stretch" align="stretch">
          <Button
            variant="outline"
            flex="1"
            onClick={() => setForceClosed(true)}
          >
            Ignore
          </Button>
          <Button onClick={refetch} flex="1">
            Retry
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
