import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { deriveVariableName } from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
  DashboardFilterType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
import { SqlVariablesProvider } from '@/components/SQLEditor/variableCompletions';
import { useConfirm } from '@/useConfirm';
import { useZIndex } from '@/zIndex';

import { MODAL_SIZE } from './constants';
import { CustomInputWrapper } from './CustomInputWrapper';
import {
  FilterFormValues,
  toFormValues,
  toSavedFilter,
} from './filterFormState';
import { QueryExpressionFilterEditForm } from './QueryExpressionFilterEditForm';
import { StaticListFilterEditForm } from './StaticListFilterEditForm';

const FILTER_TYPE_OPTIONS = [
  {
    value: DashboardFilterType.enum.QUERY_EXPRESSION,
    label: 'Queried values',
  },
  { value: DashboardFilterType.enum.STATIC_LIST, label: 'Static values' },
];

interface DashboardFilterEditFormProps {
  /** The stored filter this session started from; unset for one that does not exist yet. */
  filter?: DashboardFilter;
  /** Filters that already exist on the dashboard */
  filters: DashboardFilter[];
  /** The source to pre-fill for a new filter, if any */
  source?: TSource;
  /** Whether the broadcast / variable controls are available. */
  showVariableOptions: boolean;
  /** The dashboard's current variable state, if any */
  variables?: ChartVariable[];
  onSave: (filter: DashboardFilter) => void;
  onClose: () => void;
  onCancel: () => void;
}

/**
 * The editor for a single filter, of either type. One form covers both, so
 * switching type keeps the fields they share. Which of the fields are actually
 * stored is settled by `toSavedFilter`, not by which editor happens to be
 * mounted.
 */
export const DashboardFilterEditForm = ({
  filter,
  source: presetSource,
  filters,
  showVariableOptions,
  variables,
  onSave,
  onClose,
  onCancel,
}: DashboardFilterEditFormProps) => {
  const {
    handleSubmit,
    register,
    formState,
    control,
    setValue,
    setError,
    trigger,
  } = useForm<FilterFormValues>({
    defaultValues: toFormValues(filter, presetSource?.id),
  });

  const confirm = useConfirm();
  // Read during render so react-hook-form subscribes this component to it.
  const isDirty = formState.isDirty;

  // Keep this modal below the root confirm dialog (Mantine's default 200) so
  // the "discard unsaved changes?" prompt stacks on top of it — mirrors the
  // tile editor's z-index handling.
  const modalZIndex = useZIndex() + 10;

  // Guards against re-entrancy while the confirm dialog is open: Mantine's
  // focus management can re-fire the modal's onClose after the confirm modal
  // closes, which would otherwise stack a second dialog.
  const isConfirmingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (isConfirmingRef.current) return;
    if (!isDirty) {
      onClose();
      return;
    }
    isConfirmingRef.current = true;
    confirm(
      'You have unsaved changes. Discard them and close the editor?',
      'Discard',
    ).then(ok => {
      isConfirmingRef.current = false;
      if (ok) {
        onClose();
      }
    });
  }, [confirm, isDirty, onClose]);

  // Gates the auto-fill of Variable Name from Name below. The auto-fill itself
  // uses `setValue` without `shouldDirty`, so the field is dirty only once the
  // user has typed in it. Also gated for a filter that already has a stored
  // name, because renaming an existing filter must not silently break the tiles
  // referencing its old token.
  const hasEditedVariableName =
    !!filter?.variableName || !!formState.dirtyFields.variableName;

  const [formFilterType, formFilterName] = useWatch({
    control,
    name: ['type', 'name'],
  });
  const derivedVariableName = deriveVariableName(formFilterName ?? '');

  // Keep the variable name in sync with the display
  // name, unless the user has already edited it
  useEffect(() => {
    if (!showVariableOptions || hasEditedVariableName) return;
    setValue('variableName', derivedVariableName);
  }, [
    derivedVariableName,
    hasEditedVariableName,
    showVariableOptions,
    setValue,
  ]);

  const otherFilters = useMemo(
    () => filters.filter(f => f.id !== filter?.id),
    [filters, filter?.id],
  );

  const isNew = !filter;
  const isStaticListTypeAvailable = !!showVariableOptions;
  const showTypeInput = isStaticListTypeAvailable;

  return (
    <Modal
      title={isNew ? 'Add filter' : 'Edit filter'}
      opened
      onClose={handleClose}
      size={MODAL_SIZE}
      zIndex={modalZIndex}
    >
      <form
        onSubmit={handleSubmit(values => {
          try {
            const validated = toSavedFilter(values);
            onSave(validated);
          } catch {
            // The field rules should make this unreachable
            setError('root', {
              message: 'This filter is incomplete and could not be saved.',
            });
          }
        })}
      >
        <Stack>
          {showTypeInput && (
            <CustomInputWrapper label="Type">
              <SelectControlled
                control={control}
                name="type"
                data={FILTER_TYPE_OPTIONS}
                data-testid="filter-type-picker"
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
            </CustomInputWrapper>
          )}
          <CustomInputWrapper
            label="Display name"
            error={formState.errors.name}
          >
            <TextInput
              placeholder="Name"
              data-testid="filter-name-input"
              {...register('name', { required: true, minLength: 1 })}
            />
          </CustomInputWrapper>

          {formFilterType === 'STATIC_LIST' ? (
            <StaticListFilterEditForm
              control={control}
              otherFilters={otherFilters}
            />
          ) : (
            <SqlVariablesProvider variables={variables}>
              <QueryExpressionFilterEditForm
                control={control}
                trigger={trigger}
                pinnedSource={presetSource}
                otherFilters={otherFilters}
                showVariableOptions={showVariableOptions}
              />
            </SqlVariablesProvider>
          )}

          {formState.errors.root && (
            <Alert
              variant="danger"
              icon={<IconAlertTriangle size={16} />}
              data-testid="filter-save-error"
            >
              {formState.errors.root.message}
            </Alert>
          )}

          <Group justify="space-between" my="xs">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-testid="save-filter-button"
            >
              Save filter
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};
