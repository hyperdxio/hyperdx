import React from 'react';
import { useForm } from 'react-hook-form';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { InputControlled, PasswordInputControlled } from '../InputControlled';

// Test wrapper component that provides form context
function TestForm({ children }: { children: React.ReactNode }) {
  const { control } = useForm({
    defaultValues: {
      testInput: '',
      testPassword: '',
    },
  });

  return (
    <form>
      {React.cloneElement(children as React.ReactElement, { control })}
    </form>
  );
}

describe('InputControlled', () => {
  it('renders input with correct props', () => {
    renderWithMantine(
      <TestForm>
        <InputControlled
          name="testInput"
          placeholder="Test input"
          control={{} as any}
        />
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Test input');
    expect(input).toBeInTheDocument();
  });

  it('handles input changes', async () => {
    const { container } = renderWithMantine(
      <TestForm>
        <InputControlled
          name="testInput"
          placeholder="Test input"
          control={{} as any}
        />
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Test input');
    fireEvent.change(input, { target: { value: 'test value' } });

    await waitFor(() => {
      expect(input).toHaveValue('test value');
    });
  });
});

describe('PasswordInputControlled', () => {
  it('renders password input with correct props', () => {
    renderWithMantine(
      <TestForm>
        <PasswordInputControlled
          name="testPassword"
          placeholder="Enter password"
          control={{} as any}
        />
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('handles password input changes', async () => {
    const { container } = renderWithMantine(
      <TestForm>
        <PasswordInputControlled
          name="testPassword"
          placeholder="Enter password"
          control={{} as any}
        />
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'testpassword123' } });

    await waitFor(() => {
      expect(input).toHaveValue('testpassword123');
    });
  });
});
