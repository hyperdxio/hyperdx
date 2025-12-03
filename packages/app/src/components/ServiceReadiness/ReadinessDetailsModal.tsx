import React from 'react';
import { Badge, Group, Modal, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';

import api from '@/api';
import { CheckStatus, CheckType, Service } from '@/types';

interface ReadinessDetailsModalProps {
  opened: boolean;
  onClose: () => void;
  service: Service;
}

const CHECK_LABELS: Record<CheckType, string> = {
  [CheckType.HAS_OWNER]: 'Owner Assigned',
  [CheckType.HAS_RUNBOOK]: 'Runbook URL',
  [CheckType.HAS_REPO]: 'Repository URL',
  [CheckType.HAS_SLO]: 'SLOs Defined',
  [CheckType.HAS_LOGS]: 'Logs Detected (24h)',
  [CheckType.HAS_TRACES]: 'Traces Detected (24h)',
};

export const ReadinessDetailsModal = ({ opened, onClose, service }: ReadinessDetailsModalProps) => {
  const { data: checks, isLoading } = api.useServiceChecks(service.name);

  return (
    <Modal opened={opened} onClose={onClose} title={`Readiness Scorecard: ${service.name}`} size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Readiness checks run periodically to audit service maturity. Improve your score by fixing the failing checks below.
        </Text>

        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Check</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Details</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={3}>Loading checks...</Table.Td>
              </Table.Tr>
            ) : (
              Object.values(CheckType).map((type) => {
                const check = checks?.find((c) => c.checkType === type);
                const status = check?.status || CheckStatus.FAIL;
                const message = check?.message;

                return (
                  <Table.Tr key={type}>
                    <Table.Td>{CHECK_LABELS[type]}</Table.Td>
                    <Table.Td>
                      <Badge 
                        color={status === CheckStatus.PASS ? 'green' : 'red'} 
                        variant="light"
                      >
                        {status === CheckStatus.PASS ? 'PASS' : 'FAIL'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {message ? (
                        <Text size="sm" c="red">{message}</Text>
                      ) : (
                        <Text size="sm" c="dimmed">-</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })
            )}
          </Table.Tbody>
        </Table>
      </Stack>
    </Modal>
  );
};

