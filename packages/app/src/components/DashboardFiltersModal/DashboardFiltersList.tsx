import {
  getFilterBroadcastTarget,
  getFilterVariableName,
  isFilterVariableEnabled,
  isQueryExpressionFilter,
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

function getValuesSourceName(
  filter: DashboardFilter,
  sources?: { id: string; name: string }[],
) {
  if (isQueryExpressionFilter(filter)) {
    return sources?.find(s => s.id === filter?.source)?.name;
  }

  return 'Custom values';
}

function getBroadcastTargetDisplay(
  filter: DashboardFilter,
  sources?: { id: string; name: string }[],
) {
  const broadcastTarget = getFilterBroadcastTarget(filter);
  if (!broadcastTarget) return undefined;

  if (!broadcastTarget?.appliesToSourceIds?.length) {
    return 'All sources';
  }

  const appliedSourceNames = broadcastTarget.appliesToSourceIds
    .map(id => sources?.find(s => s.id === id)?.name)
    .filter((name): name is string => !!name);

  return appliedSourceNames.join(', ');
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
          const valuesSourceName = getValuesSourceName(filter, sources);
          const broadcastTarget = getBroadcastTargetDisplay(filter, sources);

          const variableName =
            showVariableOptions && isFilterVariableEnabled(filter)
              ? getFilterVariableName(filter)
              : undefined;
          return (
            <DashboardFilterListItem
              key={filter.id}
              name={filter.name}
              nameSuffix={variableName ? ` ($${variableName})` : undefined}
              queriedFrom={valuesSourceName ?? ''}
              queriedFromTooltip="Source of the available filter values"
              appliedTo={!hideAppliesTo ? broadcastTarget : undefined}
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
