import { Button, Modal, Stack, Text, Title } from '@mantine/core';
import { IconFilter } from '@tabler/icons-react';

import { MODAL_SIZE } from './constants';

interface DashboardFiltersEmptyStateProps {
  onCreateFilter: () => void;
  onClose: () => void;
}

export const DashboardFiltersEmptyState = ({
  onCreateFilter,
  onClose,
}: DashboardFiltersEmptyStateProps) => {
  return (
    <Modal opened onClose={onClose} size={MODAL_SIZE}>
      <Stack
        align="center"
        justify="center"
        pt="lg"
        pb="xl"
        data-testid="dashboard-filters-empty-state"
      >
        <IconFilter />
        <Title order={4}>No filters yet.</Title>
        <Text size="sm" ta="center" px="xl">
          Add filters to let viewers quickly narrow data on key columns. Saved
          filters will stay with this dashboard.
        </Text>
        <Button
          variant="primary"
          onClick={onCreateFilter}
          data-testid="add-filter-button"
        >
          Add new filter
        </Button>
      </Stack>
    </Modal>
  );
};
