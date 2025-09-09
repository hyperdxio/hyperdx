import { useEffect, useState } from 'react';
import { Button, Modal, Stack, Table, Text } from '@mantine/core';

import { useHealthCheck } from '@/hooks/useMetadata';

// Modal which will run health checks and display a popup if the user
// has incorrect access permissions to the database.
export const UnauthorizedAccessModal = () => {
  const { results, refetch, isLoading } = useHealthCheck();
  const [forceClosed, setForceClosed] = useState(false);

  const unauthorizedResults = results.filter(r => r?.isAuthError);
  const hasUnauthorized = unauthorizedResults.length > 0;

  if (isLoading) {
    return null;
  }

  return (
    <Modal
      opened={hasUnauthorized && !forceClosed}
      centered
      withCloseButton={false}
      onClose={() => {
        // If the user wants to, let them close and try.
        // They can also use this to switch teams
        setForceClosed(true);
      }}
    >
      <Stack gap="xs">
        <Text size="lg">Unauthorized</Text>
        <Text size="sm" opacity={0.7} component="div">
          <>
            <p>
              It appears that this account does not have the correct permissions
              to access this database.
            </p>
            <p>Please ensure you have the correct permissions and try again.</p>
          </>
        </Text>
        <div>
          <Text>Sources</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Source Name</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {unauthorizedResults.map(element => (
                <Table.Tr key={element!.id}>
                  <Table.Td>{element!.name}</Table.Td>
                  <Table.Td>{element!.status}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
        <Button onClick={refetch}>Retry</Button>
      </Stack>
    </Modal>
  );
};
