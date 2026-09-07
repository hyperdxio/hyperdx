import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  alertDisplayNameSchema,
  alertTagsSchema,
  MAX_TAG_LENGTH,
} from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { AlertDisplayFields } from '@/components/AlertDisplayFields';

const TAGS = ['checkout', 'payments'];

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useTags: () => ({
      data: { data: TAGS },
      isLoading: false,
      isError: false,
      refetch: jest.fn().mockResolvedValue({ data: { data: TAGS } }),
    }),
  },
}));

type FormValues = {
  displayName?: string | null;
  tags?: string[] | null;
};

const submitted = jest.fn<void, [FormValues]>();

// The real caps, so the error rendering is tested against the messages the
// alert forms actually produce.
const schema = z.object({
  displayName: alertDisplayNameSchema,
  tags: alertTagsSchema,
});

const NO_VALUES: FormValues = {};

const Harness = ({
  initial = NO_VALUES,
  derivedDisplayName,
}: {
  initial?: FormValues;
  derivedDisplayName?: string;
}) => {
  const { control, handleSubmit } = useForm<FormValues>({
    defaultValues: initial,
    resolver: zodResolver(schema),
  });
  return (
    <form onSubmit={handleSubmit(submitted)}>
      <AlertDisplayFields
        control={control}
        displayNameName="displayName"
        tagsName="tags"
        derivedDisplayName={derivedDisplayName}
      />
      <button type="submit">Submit</button>
    </form>
  );
};

const submit = async () => {
  fireEvent.click(screen.getByText('Submit'));
  await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
  return submitted.mock.calls[0][0];
};

beforeEach(() => {
  submitted.mockClear();
});

describe('AlertDisplayFields', () => {
  it('emits null when the name is cleared so the server re-derives it', async () => {
    renderWithMantine(<Harness initial={{ displayName: 'Custom' }} />);

    fireEvent.change(screen.getByTestId('alert-display-name-input'), {
      target: { value: '' },
    });

    expect((await submit()).displayName).toBeNull();
  });

  it('shows the derived name as the placeholder', () => {
    renderWithMantine(<Harness derivedDisplayName="Checkout - Error rate" />);

    expect(screen.getByTestId('alert-display-name-input')).toHaveAttribute(
      'placeholder',
      'Checkout - Error rate',
    );
  });

  it('falls back to a generic placeholder without a derived name', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('alert-display-name-input')).toHaveAttribute(
      'placeholder',
      'Defaults to the saved search or dashboard tile name',
    );
  });

  it('emits the typed name', async () => {
    renderWithMantine(<Harness />);

    fireEvent.change(screen.getByTestId('alert-display-name-input'), {
      target: { value: 'Checkout 5xx' },
    });

    expect((await submit()).displayName).toBe('Checkout 5xx');
  });

  it('shows the schema error for a whitespace-only name and blocks submit', async () => {
    renderWithMantine(<Harness />);

    fireEvent.change(screen.getByTestId('alert-display-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Submit'));

    expect(
      await screen.findByText(/at least 1 character/i),
    ).toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('shows the schema error for an over-long tag and blocks submit', async () => {
    renderWithMantine(
      <Harness initial={{ tags: ['x'.repeat(MAX_TAG_LENGTH + 1)] }} />,
    );

    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByTestId('alert-tags-error')).toHaveTextContent(
      /at most 32 character/i,
    );
    expect(submitted).not.toHaveBeenCalled();
  });

  it('emits an array once a tag is picked', async () => {
    renderWithMantine(<Harness />);

    fireEvent.click(screen.getByTestId('alert-tags-button'));
    fireEvent.click(await screen.findByText('CHECKOUT'));

    expect((await submit()).tags).toEqual(['checkout']);
  });

  it('leaves untouched tags undefined so the server derives them', async () => {
    renderWithMantine(<Harness />);

    // An unset list inherits, so the button must not claim zero tags.
    expect(screen.getByTestId('alert-tags-button')).toHaveTextContent(
      'Inherited',
    );
    expect((await submit()).tags).toBeUndefined();
  });

  it('counts the tags once the list is set', async () => {
    renderWithMantine(<Harness initial={{ tags: ['checkout'] }} />);

    expect(screen.getByTestId('alert-tags-button')).toHaveTextContent('1');
  });

  it('counts zero for a deliberately emptied list', async () => {
    renderWithMantine(<Harness initial={{ tags: [] }} />);

    const button = screen.getByTestId('alert-tags-button');
    expect(button).toHaveTextContent('0');
    expect(button).not.toHaveTextContent('Inherited');
  });
});
