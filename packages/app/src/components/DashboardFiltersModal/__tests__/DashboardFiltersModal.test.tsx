import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DashboardFiltersModal from '@/components/DashboardFiltersModal';
import { FilterFormControl } from '@/components/DashboardFiltersModal/filterFormState';

// ConfirmProvider pulls in next/router, which jsdom has no answer for.
jest.mock('@/useConfirm', () => ({ useConfirm: () => jest.fn() }));

jest.mock('@/source', () => ({ useSources: () => ({ data: [] }) }));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

/**
 * Stands in for the queried editor, which would drag CodeMirror and the source
 * metadata queries into jsdom. It registers the same required fields as the
 * real form, so the tests still cover what those rules do to a save once the
 * user has switched to the other type.
 */
jest.mock(
  '@/components/DashboardFiltersModal/QueryExpressionFilterEditForm',
  () => ({
    QueryExpressionFilterEditForm: ({
      control,
    }: {
      control: FilterFormControl;
    }) => (
      <div>
        <input
          data-testid="filter-expression-input"
          {...control.register('expression', { required: true })}
        />
        <input
          data-testid="source-selector"
          {...control.register('source', { required: true })}
        />
      </div>
    ),
  }),
);

const EXISTING_FILTER: DashboardFilter = {
  id: 'other',
  type: 'QUERY_EXPRESSION',
  name: 'Service',
  expression: 'ServiceName',
  source: 'logs',
  isVariableEnabled: true,
  variableName: 'env',
};

const EXISTING_STATIC_FILTER: DashboardFilter = {
  id: 'static',
  type: 'STATIC_LIST',
  name: 'Environment',
  options: ['prod'],
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'env',
};

const renderModal = (
  props: Partial<React.ComponentProps<typeof DashboardFiltersModal>> = {},
) => {
  const onSaveFilter = jest.fn();
  renderWithMantine(
    <DashboardFiltersModal
      opened
      filters={[]}
      showVariableOptions
      showRequiredFilterOptions
      onClose={jest.fn()}
      onSaveFilter={onSaveFilter}
      onRemoveFilter={jest.fn()}
      {...props}
    />,
  );
  return { onSaveFilter, user: userEvent.setup() };
};

const selectFilterType = async (
  user: ReturnType<typeof userEvent.setup>,
  label: 'Queried values' | 'Static values',
) => {
  await user.click(screen.getByTestId('filter-type-picker'));
  // The dropdown's options are matched by text: jsdom has none of Mantine's
  // stylesheet, so it reports them as inaccessible and `*ByRole` skips them.
  await user.click(await screen.findByText(label));
};

describe('DashboardFiltersModal', () => {
  it('saves a variable-only static filter carrying the authored options in order', async () => {
    const { onSaveFilter, user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    const options = screen.getByTestId('filter-options-input');
    for (const option of ['prod', 'staging', 'dev']) {
      await user.type(options, `${option}{Enter}`);
    }
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter).toHaveBeenCalledWith({
      id: expect.any(String),
      type: 'STATIC_LIST',
      name: 'Environment',
      options: ['prod', 'staging', 'dev'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      // Derived from the display name, since it was never edited by hand.
      variableName: 'Environment',
    });
  });

  it('keeps the fields both types share when the type changes', async () => {
    const { user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-expression-input'), 'Env');

    await selectFilterType(user, 'Static values');

    expect(screen.getByTestId('filter-name-input')).toHaveValue('Environment');

    await user.clear(screen.getByTestId('filter-variable-name-input'));
    await user.type(screen.getByTestId('filter-variable-name-input'), 'env');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');

    await selectFilterType(user, 'Queried values');

    expect(screen.getByTestId('filter-name-input')).toHaveValue('Environment');
    expect(screen.getByTestId('filter-expression-input')).toHaveValue('Env');

    await selectFilterType(user, 'Static values');

    expect(screen.getByTestId('filter-variable-name-input')).toHaveValue('env');
    expect(screen.getByText('prod')).toBeInTheDocument();
  });

  it('does not let the queried fields block a static save', async () => {
    const { onSaveFilter, user } = renderModal();

    // The queried editor mounts first, registering its required fields; the
    // static filter has no answer for them and must save anyway.
    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STATIC_LIST', options: ['prod'] }),
    );
  });

  it('drops the fields belonging to the type the user did not settle on', async () => {
    const { onSaveFilter, user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await user.type(screen.getByTestId('filter-expression-input'), 'Env');
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter.mock.calls[0][0]).not.toHaveProperty('expression');
    expect(onSaveFilter.mock.calls[0][0]).not.toHaveProperty('source');
  });

  it('refuses to save a static filter without an option', async () => {
    const { onSaveFilter, user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.click(screen.getByTestId('save-filter-button'));

    expect(await screen.findByText('Add at least one option')).toBeVisible();
    expect(onSaveFilter).not.toHaveBeenCalled();
  });

  it('rejects a variable name already taken by another filter', async () => {
    const { onSaveFilter, user } = renderModal({ filters: [EXISTING_FILTER] });

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');
    await user.clear(screen.getByTestId('filter-variable-name-input'));
    await user.type(screen.getByTestId('filter-variable-name-input'), 'env');
    await user.click(screen.getByTestId('save-filter-button'));

    expect(
      await screen.findByText(/used by another filter on this dashboard/),
    ).toBeVisible();
    expect(onSaveFilter).not.toHaveBeenCalled();
  });

  it('stops deriving the variable name once the user edits it', async () => {
    const { user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Env');
    expect(screen.getByTestId('filter-variable-name-input')).toHaveValue('Env');

    await user.clear(screen.getByTestId('filter-variable-name-input'));
    await user.type(
      screen.getByTestId('filter-variable-name-input'),
      'custom_env',
    );
    await user.type(screen.getByTestId('filter-name-input'), 'ironment');

    expect(screen.getByTestId('filter-variable-name-input')).toHaveValue(
      'custom_env',
    );
  });

  it('leaves a stored variable name alone when the display name changes', async () => {
    const { onSaveFilter, user } = renderModal({
      filters: [EXISTING_STATIC_FILTER],
    });

    await user.click(screen.getByTestId('edit-filter-button-Environment'));
    await user.clear(screen.getByTestId('filter-name-input'));
    await user.type(screen.getByTestId('filter-name-input'), 'Deploy target');

    expect(screen.getByTestId('filter-variable-name-input')).toHaveValue('env');

    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Deploy target', variableName: 'env' }),
    );
  });

  it('offers the type picker while the filter is unsaved', async () => {
    const { user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));

    expect(screen.getByTestId('filter-type-picker')).toBeVisible();
  });

  it('offers the type picker for a saved filter', async () => {
    const { user } = renderModal({ filters: [EXISTING_FILTER] });

    await user.click(screen.getByTestId('edit-filter-button-Service'));

    expect(screen.getByTestId('filter-name-input')).toHaveValue('Service');
    expect(screen.getByTestId('filter-type-picker')).toBeVisible();
  });

  it('converts a saved queried filter to a static one', async () => {
    const { onSaveFilter, user } = renderModal({ filters: [EXISTING_FILTER] });

    await user.click(screen.getByTestId('edit-filter-button-Service'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-options-input'), 'api{Enter}');
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter).toHaveBeenCalledWith({
      // The same filter, so the tiles referencing it keep working.
      id: EXISTING_FILTER.id,
      type: 'STATIC_LIST',
      name: 'Service',
      options: ['api'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      // Kept, so the tiles referencing $env keep working.
      variableName: 'env',
    });
  });

  it('converts a saved static filter to a queried one', async () => {
    const { onSaveFilter, user } = renderModal({
      filters: [EXISTING_STATIC_FILTER],
    });

    await user.click(screen.getByTestId('edit-filter-button-Environment'));
    await selectFilterType(user, 'Queried values');
    await user.type(screen.getByTestId('filter-expression-input'), 'Env');
    await user.type(screen.getByTestId('source-selector'), 'logs');
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    expect(onSaveFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: EXISTING_STATIC_FILTER.id,
        type: 'QUERY_EXPRESSION',
        expression: 'Env',
        source: 'logs',
        variableName: 'env',
      }),
    );
    expect(onSaveFilter.mock.calls[0][0]).not.toHaveProperty('options');
  });

  it('omits the PromQL type where PromQL is disabled', async () => {
    const { user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await user.click(screen.getByTestId('filter-type-picker'));

    expect(await screen.findByText('Static values')).toBeInTheDocument();
    expect(screen.queryByText('PromQL label values')).toBeNull();
  });

  it('hides the type picker where variables are unavailable', async () => {
    const { user } = renderModal({ showVariableOptions: false });

    await user.click(screen.getByTestId('add-filter-button'));

    expect(screen.queryByTestId('filter-type-picker')).toBeNull();
  });

  it.each(['Queried values', 'Static values'] as const)(
    'offers the required control on a %s filter',
    async label => {
      const { user } = renderModal();

      await user.click(screen.getByTestId('add-filter-button'));
      await selectFilterType(user, label);

      expect(
        screen.getByTestId('filter-required-checkbox'),
      ).toBeInTheDocument();
    },
  );

  // A dashboard that draws its tiles without consulting the filters enforces
  // nothing, so offering the control there would promise something that never
  // happens.
  it('hides the required control where a requirement is not enforced', async () => {
    const { user } = renderModal({ showRequiredFilterOptions: false });

    await user.click(screen.getByTestId('add-filter-button'));

    expect(screen.queryByTestId('filter-required-checkbox')).toBeNull();
  });

  // Requiring a value and publishing a variable are unrelated: a filter that
  // only broadcasts can still be required.
  it('offers the required control where variables are unavailable', async () => {
    const { user } = renderModal({ showVariableOptions: false });

    await user.click(screen.getByTestId('add-filter-button'));

    expect(screen.getByTestId('filter-required-checkbox')).toBeInTheDocument();
  });

  it('saves a required filter and reopens it checked', async () => {
    const { onSaveFilter, user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');
    await user.click(screen.getByTestId('filter-required-checkbox'));
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    const saved: DashboardFilter = onSaveFilter.mock.calls[0][0];
    expect(saved.minSelections).toBe(1);
    expect(saved.isGlobalRequirement).toBeUndefined();

    renderModal({ filters: [saved] });
    await user.click(
      screen.getAllByTestId(`edit-filter-button-${saved.name}`)[0],
    );

    expect(screen.getByTestId('filter-required-checkbox')).toBeChecked();
  });

  it('offers the requirement scope, unchecked, once the filter is required', async () => {
    const { user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');

    expect(
      screen.queryByTestId('filter-global-requirement-checkbox'),
    ).toBeNull();

    await user.click(screen.getByTestId('filter-required-checkbox'));

    expect(
      screen.getByTestId('filter-global-requirement-checkbox'),
    ).not.toBeChecked();
  });

  it('saves a dashboard-wide requirement and reopens it checked', async () => {
    const { onSaveFilter, user } = renderModal();

    await user.click(screen.getByTestId('add-filter-button'));
    await selectFilterType(user, 'Static values');
    await user.type(screen.getByTestId('filter-name-input'), 'Environment');
    await user.type(screen.getByTestId('filter-options-input'), 'prod{Enter}');
    await user.click(screen.getByTestId('filter-required-checkbox'));
    await user.click(screen.getByTestId('filter-global-requirement-checkbox'));
    await user.click(screen.getByTestId('save-filter-button'));

    await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
    const saved: DashboardFilter = onSaveFilter.mock.calls[0][0];
    expect(saved.minSelections).toBe(1);
    expect(saved.isGlobalRequirement).toBe(true);

    renderModal({ filters: [saved] });
    await user.click(
      screen.getAllByTestId(`edit-filter-button-${saved.name}`)[0],
    );

    expect(
      screen.getByTestId('filter-global-requirement-checkbox'),
    ).toBeChecked();
  });

  it('marks a required filter in the list, whatever its reach', () => {
    renderModal({
      filters: [
        { ...EXISTING_STATIC_FILTER, minSelections: 1 },
        { ...EXISTING_FILTER, minSelections: 1, isGlobalRequirement: true },
      ],
    });

    for (const { name } of [EXISTING_STATIC_FILTER, EXISTING_FILTER]) {
      expect(
        screen.getByTestId(`dashboard-filter-required-attr-${name}`),
      ).toHaveTextContent(/^Required$/);
    }
  });

  it('leaves an optional filter unmarked', () => {
    renderModal({ filters: [EXISTING_STATIC_FILTER] });

    expect(
      screen.queryByTestId(
        `dashboard-filter-required-attr-${EXISTING_STATIC_FILTER.name}`,
      ),
    ).toBeNull();
  });
});
