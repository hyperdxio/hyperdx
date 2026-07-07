import { useForm, useWatch } from 'react-hook-form';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AutocompleteControlled } from '@/components/InputControlled';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const SECTIONS = ['Billing', 'Control Plane Prod'];

function Harness({ data = SECTIONS }: { data?: string[] }) {
  const { control } = useForm<{ section: string }>({
    defaultValues: { section: '' },
  });
  const value = useWatch({ control, name: 'section' });
  return (
    <>
      <AutocompleteControlled
        control={control}
        name="section"
        data={data}
        placeholder="Section"
        maxLength={256}
      />
      <div data-testid="value">{value}</div>
    </>
  );
}

describe('AutocompleteControlled (Section field)', () => {
  it('forwards maxLength to the underlying input', () => {
    renderWithMantine(<Harness />);
    expect(screen.getByPlaceholderText('Section')).toHaveAttribute(
      'maxlength',
      '256',
    );
  });

  it('suggests existing section names', async () => {
    renderWithMantine(<Harness />);
    await userEvent.click(screen.getByPlaceholderText('Section'));
    expect(await screen.findByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Control Plane Prod')).toBeInTheDocument();
  });

  it('selecting a suggestion sets the field value', async () => {
    renderWithMantine(<Harness />);
    await userEvent.click(screen.getByPlaceholderText('Section'));
    await userEvent.click(await screen.findByText('Control Plane Prod'));
    expect(screen.getByTestId('value')).toHaveTextContent('Control Plane Prod');
  });

  it('accepts a brand-new value not in the suggestions (free-text)', async () => {
    renderWithMantine(<Harness />);
    const input = screen.getByPlaceholderText('Section');
    await userEvent.type(input, 'Fraud Detection');
    // The typed value reaches the form state even though it is not a suggestion.
    expect(input).toHaveValue('Fraud Detection');
    expect(screen.getByTestId('value')).toHaveTextContent('Fraud Detection');
  });
});
