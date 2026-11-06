import {
  ADHOC_FILTER_MAX_CONDITIONS,
  AdhocDashboardFilter,
  AdhocFilterConditionSchema,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

export function notifyAdhocFilterFull(
  filter: Pick<AdhocDashboardFilter, 'id' | 'name'>,
) {
  notifications.show({
    id: `adhoc-filter-full-${filter.id}`,
    color: 'yellow',
    title: `${filter.name} is full`,
    message: `A filter holds up to ${ADHOC_FILTER_MAX_CONDITIONS} conditions. Remove one to add another.`,
  });
}

export function notifyAdhocConditionTooLong(
  filter: Pick<AdhocDashboardFilter, 'id'>,
) {
  const maxLength = AdhocFilterConditionSchema.shape.value.maxLength;
  notifications.show({
    id: `adhoc-filter-too-long-${filter.id}`,
    color: 'yellow',
    title: 'Condition is too long',
    message: `Keys and values can be up to ${maxLength?.toLocaleString()} characters.`,
  });
}
