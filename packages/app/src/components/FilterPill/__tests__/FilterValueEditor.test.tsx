import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FilterValueEditor,
  FilterValueEditorProps,
} from '@/components/FilterPill/FilterValueEditor';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks
// it. jsdom also has no layout, so options must be queried with { hidden: true }.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const renderEditor = (props: Partial<FilterValueEditorProps> = {}) => {
  const handlers = {
    onReplaceValue: jest.fn(),
    onTogglePolarity: jest.fn(),
    onDone: jest.fn(),
  };
  renderWithMantine(
    <FilterValueEditor
      value="200"
      valueOptions={[]}
      isExcluded={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

const valueInput = () =>
  screen.getByRole('combobox', { name: 'Change filter value' });

describe('FilterValueEditor', () => {
  it('lists the current value alongside the suggestions', async () => {
    renderEditor({ valueOptions: ['404', '200'] });
    await userEvent.click(valueInput());
    const options = await screen.findAllByRole('option', { hidden: true });
    expect(options.map(o => o.textContent)).toEqual(['200', '404']);
  });

  it('replaces with the trimmed typed value', async () => {
    const { onReplaceValue, onDone } = renderEditor();
    await userEvent.type(valueInput(), '  418  {enter}');
    expect(onReplaceValue).toHaveBeenCalledWith('418');
    expect(onDone).toHaveBeenCalled();
  });

  it('does not replace when the value is unchanged or empty', async () => {
    const { onReplaceValue, onDone } = renderEditor();
    await userEvent.type(valueInput(), '{enter}');
    await userEvent.type(valueInput(), '200{enter}');
    expect(onReplaceValue).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('shows a loading placeholder while values load', () => {
    renderEditor({ isLoadingValues: true });
    expect(valueInput()).toHaveAttribute('placeholder', 'Loading values...');
  });

  it.each([
    [false, 'Exclude'],
    [true, 'Include'],
  ])('offers to flip polarity (excluded: %s)', async (isExcluded, label) => {
    const { onTogglePolarity, onDone } = renderEditor({ isExcluded });
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onTogglePolarity).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
