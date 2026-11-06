import { useController, useForm } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { NetflowTableModelForm } from '@/components/Sources/SourceForm/NetflowTableModelForm';

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: (
    props: Parameters<typeof useController<TSource>>[0] & {
      placeholder: string;
    },
  ) => {
    const { field } = useController(props);
    return (
      <input
        aria-label={field.name}
        placeholder={props.placeholder}
        value={String(field.value ?? '')}
        onChange={field.onChange}
      />
    );
  },
}));

it('persists an optional full-text expression without changing mapped columns', async () => {
  const onSubmit = jest.fn();
  function Form() {
    const { control, setValue, handleSubmit } = useForm<TSource>({
      defaultValues: {
        kind: SourceKind.Netflow,
        bytesExpression: 'Octets',
        srcAddrExpression: 'ClientIP',
      },
    });
    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        <NetflowTableModelForm control={control} setValue={setValue} />
        <button type="submit">Save</button>
      </form>
    );
  }
  renderWithMantine(<Form />);
  expect(
    screen.getByText('Full-text search expression (optional)'),
  ).toBeInTheDocument();
  const input = screen.getByLabelText('implicitColumnExpression');
  expect(input).toHaveValue('');
  fireEvent.change(input, {
    target: { value: 'concat(ClientIP, RouterName)' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        implicitColumnExpression: 'concat(ClientIP, RouterName)',
        bytesExpression: 'Octets',
        srcAddrExpression: 'ClientIP',
      }),
      expect.anything(),
    ),
  );
});
