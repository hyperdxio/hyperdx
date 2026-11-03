import { act, screen } from '@testing-library/react';
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

  it('shows a loading indicator on the value input once a key is entered', async () => {
    renderEditor({ isLoadingValues: true });
    expect(
      screen.queryByTestId('filter-condition-editor-value-loading'),
    ).toBeNull();
    await userEvent.type(keyInput(), 'ServiceName');
    expect(
      screen.getByTestId('filter-condition-editor-value-loading'),
    ).toBeInTheDocument();
  });

  it('shows an error on the key input when keys fail to load', () => {
    renderEditor({ isKeysError: true });
    expect(screen.getByText("Couldn't load suggestions")).toBeInTheDocument();
  });

  it('shows a value error only once the key settles', async () => {
    renderEditor({ isValuesError: true });
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

  it('reports the key only once it stops changing', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const onKeyChange = jest.fn();
      renderEditor({ onKeyChange });
      await user.type(keyInput(), 'Svc');
      expect(onKeyChange).not.toHaveBeenCalledWith('Sv');
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(onKeyChange).toHaveBeenLastCalledWith('Svc');
    } finally {
      jest.useRealTimers();
    }
  });
});
