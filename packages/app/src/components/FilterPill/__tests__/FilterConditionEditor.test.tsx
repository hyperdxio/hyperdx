import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FilterConditionEditor,
  FilterConditionEditorProps,
} from '@/components/FilterPill/FilterConditionEditor';
import {
  FilterOperator,
  PROMQL_FILTER_OPERATORS,
  SQL_FILTER_OPERATORS,
} from '@/components/FilterPill/filterOperators';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks
// it. jsdom also has no layout, so options must be queried with { hidden: true }.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const renderEditor = (
  props: Partial<FilterConditionEditorProps<FilterOperator>> = {},
) => {
  const onSubmit = jest.fn();
  renderWithMantine(
    <FilterConditionEditor
      operators={SQL_FILTER_OPERATORS}
      keyOptions={[]}
      valueOptions={[]}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return onSubmit;
};

const keyInput = () => screen.getByRole('combobox', { name: 'Key' });
const valueInput = (name = 'Value') => screen.getByRole('combobox', { name });
const applyButton = () => screen.getByRole('button', { name: 'Apply' });

describe('FilterConditionEditor', () => {
  it('shows a loading indicator on the key input while keys load', () => {
    renderEditor({ isLoadingKeys: true });
    expect(
      screen.getByTestId('filter-condition-editor-key-loading'),
    ).toBeInTheDocument();
  });

  it("shows a loading indicator on the value input while a key's values load", async () => {
    renderEditor({ isLoadingValues: true, keyOptions: ['ServiceName'] });
    expect(
      screen.queryByTestId('filter-condition-editor-value-loading'),
    ).toBeNull();
    await userEvent.type(keyInput(), 'ServiceName');
    expect(
      await screen.findByTestId('filter-condition-editor-value-loading'),
    ).toBeInTheDocument();
  });

  it('shows an error on the key input when keys fail to load', () => {
    renderEditor({ isKeysError: true });
    expect(screen.getByText("Couldn't load suggestions")).toBeInTheDocument();
  });

  it('says why keys failed to load, using the first line of the error', () => {
    renderEditor({
      isKeysError: true,
      keysErrorMessage:
        "Primary key (Namespace) is not used and setting 'force_primary_key' is set\nStack trace: ...",
    });
    expect(
      screen.getByText(
        "Couldn't load suggestions: Primary key (Namespace) is not used and setting 'force_primary_key' is set",
      ),
    ).toBeInTheDocument();
  });

  it('shows a value error only once the key settles', async () => {
    renderEditor({ isValuesError: true, keyOptions: ['ServiceName'] });
    expect(screen.queryByText("Couldn't load suggestions")).toBeNull();
    await userEvent.type(keyInput(), 'ServiceName');
    expect(
      await screen.findByText("Couldn't load suggestions"),
    ).toBeInTheDocument();
  });

  it('submits free-form text on Enter in the value input', async () => {
    const onSubmit = renderEditor({ isLoadingValues: true });
    // `[[` types a literal `[`.
    await userEvent.type(keyInput(), "LogAttributes[['custom']");
    await userEvent.type(valueInput(), 'anything{enter}');
    expect(onSubmit).toHaveBeenCalledWith({
      key: "LogAttributes['custom']",
      operator: '=',
      value: 'anything',
    });
  });

  describe('ranking key suggestions', () => {
    /** The key input's suggestions, in order, once `typed` is entered. */
    const typedOptions = async (typed: string) => {
      await userEvent.type(keyInput(), typed);
      const listbox = document.getElementById(
        keyInput().getAttribute('aria-controls') ?? '',
      );
      const options = await within(listbox!).findAllByRole('option', {
        hidden: true,
      });
      return options.map(option => option.textContent);
    };

    it('lists keys starting with the text first, then keys with a part starting with it', async () => {
      renderEditor({
        keyOptions: [
          "LogAttributes['agentToServer.status']",
          "ResourceAttributes['service.name']",
          'ServiceName',
        ],
      });

      expect(await typedOptions('Serv')).toEqual([
        'ServiceName',
        "ResourceAttributes['service.name']",
        "LogAttributes['agentToServer.status']",
      ]);
    });

    it('ranks every match before cutting the list down', async () => {
      renderEditor({
        keyOptions: [
          ...Array.from(
            { length: 250 },
            (_, i) => `LogAttributes['agentToServer.${i}']`,
          ),
          'ServiceName',
        ],
      });

      const options = await typedOptions('Serv');
      expect(options[0]).toBe('ServiceName');
      expect(options).toHaveLength(200);
    });
  });

  it('moves focus to the value input on Enter in the key input', async () => {
    const onSubmit = renderEditor();
    await userEvent.type(keyInput(), 'ServiceName{enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(valueInput()).toHaveFocus();
  });

  it('fills the value from a picked suggestion without submitting', async () => {
    const onSubmit = renderEditor({
      initial: { key: 'ServiceName', operator: '=', value: '' },
      valueOptions: ['checkout', 'frontend'],
    });
    await userEvent.click(valueInput());
    await userEvent.click(
      await screen.findByRole('option', { name: 'frontend', hidden: true }),
    );
    expect(valueInput()).toHaveValue('frontend');
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(applyButton());
    expect(onSubmit).toHaveBeenCalledWith({
      key: 'ServiceName',
      operator: '=',
      value: 'frontend',
    });
  });

  it('submits the chosen operator and relabels the value for regex', async () => {
    const onSubmit = renderEditor({
      initial: { key: 'ServiceName', operator: '=', value: '' },
    });
    await userEvent.click(screen.getByRole('combobox', { name: 'Operator' }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'regex', hidden: true }),
    );
    await userEvent.type(valueInput('Pattern'), '^check{enter}');
    expect(onSubmit).toHaveBeenCalledWith({
      key: 'ServiceName',
      operator: '=~',
      value: '^check',
    });
  });

  it('offers only the given operators', async () => {
    renderEditor({ operators: PROMQL_FILTER_OPERATORS });
    await userEvent.click(screen.getByRole('combobox', { name: 'Operator' }));
    const options = await screen.findAllByRole('option', { hidden: true });
    expect(options.map(o => o.textContent)).toEqual(['=', '!=', '=~', '!~']);
  });

  it('disables Apply until a key is entered', async () => {
    const onSubmit = renderEditor({
      initial: { key: 'job', operator: '!=', value: 'api' },
      operators: PROMQL_FILTER_OPERATORS,
    });
    expect(applyButton()).toBeEnabled();
    await userEvent.click(applyButton());
    expect(onSubmit).toHaveBeenCalledWith({
      key: 'job',
      operator: '!=',
      value: 'api',
    });

    await userEvent.clear(keyInput());
    expect(applyButton()).toBeDisabled();
  });

  describe('reporting the key to look up values for', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const setup = (
      props: Partial<FilterConditionEditorProps<FilterOperator>> = {},
    ) => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const onKeyChange = jest.fn();
      renderEditor({ keyOptions: ['ServiceName'], onKeyChange, ...props });
      const pause = () =>
        act(() => {
          jest.advanceTimersByTime(300);
        });
      return { user, onKeyChange, pause };
    };

    it('reports a suggested key once typing pauses, never a partial one', async () => {
      const { user, onKeyChange, pause } = setup();

      await user.type(keyInput(), 'Service');
      pause();
      expect(onKeyChange).not.toHaveBeenCalledWith('Service');

      await user.type(keyInput(), 'Name');
      pause();
      expect(onKeyChange).toHaveBeenLastCalledWith('ServiceName');
    });

    it('reports a key typed by hand once Enter commits it', async () => {
      const { user, onKeyChange, pause } = setup();

      await user.type(keyInput(), 'Custom');
      pause();
      expect(onKeyChange).not.toHaveBeenCalledWith('Custom');

      await user.keyboard('{Enter}');
      expect(onKeyChange).toHaveBeenLastCalledWith('Custom');
    });

    it('reports a key typed by hand once focus leaves the key input', async () => {
      const { user, onKeyChange } = setup();

      await user.type(keyInput(), 'Custom');
      await user.click(valueInput());

      expect(onKeyChange).toHaveBeenLastCalledWith('Custom');
    });

    it('reports the key being edited right away', () => {
      const { onKeyChange } = setup({
        initial: { key: 'Custom', operator: '=', value: '' },
      });

      expect(onKeyChange).toHaveBeenLastCalledWith('Custom');
    });
  });
});
