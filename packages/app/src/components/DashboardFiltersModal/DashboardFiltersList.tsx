import {
  getFilterVariableName,
  isFilterBroadcastEnabled,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Center,
  Group,
  Modal,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { IconPencil, IconRefresh, IconTrash } from '@tabler/icons-react';

import { useSources } from '@/source';

import { MODAL_SIZE } from './constants';
import { DashboardFilterListItem } from './DashboardFiltersListItem';

import styles from '@styles/DashboardFiltersModal.module.scss';

interface DashboardFiltersListProps {
  filters: DashboardFilter[];
  isLoading?: boolean;
  hideAppliesTo?: boolean;
  /** Whether the broadcast / variable controls are available. */
  showVariableOptions: boolean;
  onEdit: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

export const DashboardFiltersList = ({
  filters,
  isLoading,
  hideAppliesTo,
  showVariableOptions,
  onEdit,
  onRemove,
  onClose,
  onAddNew,
}: DashboardFiltersListProps) => {
  const { data: sources } = useSources();

  return (
    <Modal
      opened
      onClose={onClose}
      title={showVariableOptions ? 'Filters and Variables' : 'Filters'}
      size={MODAL_SIZE}
      className={styles.modal}
    >
      <Stack
        className={styles.filtersContainer}
        gap="xs"
        data-testid="dashboard-filters-list"
      >
        {filters.map(filter => {
          const queriedSourceName = sources?.find(
            s => s.id === filter.source,
          )?.name;
          const appliedSourceNames = filter.appliesToSourceIds?.length
            ? filter.appliesToSourceIds
                .map(id => sources?.find(s => s.id === id)?.name)
                .filter((name): name is string => !!name)
            : undefined;
          const appliedDisplay = appliedSourceNames
            ? appliedSourceNames.join(', ')
            : 'All sources';
          const variableName =
            showVariableOptions && isFilterVariableEnabled(filter)
              ? getFilterVariableName(filter)
              : undefined;
          return (
            <DashboardFilterListItem
              key={filter.id}
              name={filter.name}
              nameSuffix={variableName ? ` ($${variableName})` : undefined}
              queriedFrom={queriedSourceName ?? ''}
              queriedFromTooltip="Source the dropdown values are queried from"
              appliedTo={
                !hideAppliesTo && isFilterBroadcastEnabled(filter)
                  ? appliedDisplay
                  : undefined
              }
              actions={
                <>
                  <UnstyledButton
                    onClick={() => onEdit(filter)}
                    className={styles.filterActionButton}
                    data-testid={`edit-filter-button-${filter.name}`}
                  >
                    <IconPencil size={16} />
                  </UnstyledButton>
                  <UnstyledButton
                    onClick={() => onRemove(filter.id)}
                    className={`${styles.filterActionButton} ${styles.deleteButton}`}
                    data-testid={`delete-filter-button-${filter.name}`}
                  >
                    <IconTrash size={16} />
                  </UnstyledButton>
                </>
              }
            />
          );
        })}
        {isLoading && (
          <Center>
            <IconRefresh className="spin-animate" />
          </Center>
        )}
      </Stack>

      <Group justify="space-between" my="sm">
        <Button
          variant="secondary"
          onClick={onClose}
          data-testid="close-filters-button"
        >
          Close
        </Button>
        <Button
          variant="primary"
          onClick={onAddNew}
          data-testid="add-filter-button"
        >
          Add new filter
        </Button>
      </Group>
    </Modal>
  );
};
