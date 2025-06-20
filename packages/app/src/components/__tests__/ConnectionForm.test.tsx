import React from 'react';
import { Connection } from '@hyperdx/common-utils/dist/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConnectionForm } from '../ConnectionForm';

import '@testing-library/jest-dom';

// --- Mocks ---
const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
jest.mock('@/connection', () => ({
  ...jest.requireActual('@/connection'),
  useCreateConnection: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
  useUpdateConnection: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),

  useDeleteConnection: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock('@mantine/notifications', () => ({
  notifications: {
    show: jest.fn(),
  },
}));

const mockTestConnectionMutateAsync = jest.fn();
jest.mock('@/api', () => ({
  ...(jest.requireActual('@/api') ?? {}),
  useTestConnection: () => ({
    mutateAsync: mockTestConnectionMutateAsync.mockResolvedValue({
      success: true,
    }),
  }),
}));

// --- Test Suite ---

describe('ConnectionForm', () => {
  const baseConnection: Connection = {
    id: '',
    name: 'Test Connection',
    host: 'http://localhost:8123',
    username: 'default',
    password: '',
  };

  beforeEach(() => {
    mockCreateMutate.mockClear();
    mockUpdateMutate.mockClear();
    mockTestConnectionMutateAsync.mockClear();
    (
      jest.requireMock('@mantine/notifications') as any
    ).notifications.show.mockClear();
  });

  it('should save connection with trailing slash removed from host when creating', async () => {
    renderWithMantine(
      <ConnectionForm connection={baseConnection} isNew={true} />,
    );

    const hostInput = screen.getByPlaceholderText('http://localhost:8123');
    const nameInput = screen.getByPlaceholderText('My Clickhouse Server');
    const submitButton = screen.getByRole('button', { name: 'Create' });

    await fireEvent.change(nameInput, { target: { value: 'Test Name' } });
    await fireEvent.change(hostInput, {
      target: { value: 'http://example.com:8123/' },
    }); // Host with trailing slash

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    });

    // Check the arguments passed to the mutate function
    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({
          host: 'http://example.com:8123',
          name: 'Test Name',
        }),
      }),
      expect.anything(),
    );
  });

  it('should save connection with trailing slash removed from host when updating', async () => {
    const existingConnection = {
      ...baseConnection,
      id: 'existing-id',
      host: 'http://old.com/',
    };
    renderWithMantine(
      <ConnectionForm connection={existingConnection} isNew={false} />,
    );

    const hostInput = screen.getByPlaceholderText('http://localhost:8123');
    const submitButton = screen.getByRole('button', { name: 'Save' });

    // Update host
    await fireEvent.change(hostInput, {
      target: { value: 'http://updated.com:8123/' },
    });

    fireEvent.click(submitButton);

    // Wait for mutate to be called and assert
    await waitFor(() => {
      expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    });

    // Check the arguments passed to the mutate function
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-id',
        connection: expect.objectContaining({
          host: 'http://updated.com:8123',
        }),
      }),
      expect.anything(),
    );
  });

  it('should use stripped host for test connection', async () => {
    renderWithMantine(
      <ConnectionForm connection={baseConnection} isNew={true} />,
    );
    const hostInput = screen.getByPlaceholderText('http://localhost:8123');

    const nameInput = screen.getByPlaceholderText('My Clickhouse Server');
    const testButton = screen.getByRole('button', { name: 'Test Connection' });

    await fireEvent.change(nameInput, { target: { value: 'Test Name' } });
    await fireEvent.change(hostInput, {
      target: { value: 'http://test.com:8123/' },
    });

    // Ensure form state is valid before clicking test
    await waitFor(() => expect(testButton).not.toBeDisabled());

    fireEvent.click(testButton);

    await waitFor(() =>
      expect(mockTestConnectionMutateAsync).toHaveBeenCalled(),
    );

    // Assert that the mock API call received the stripped host
    expect(mockTestConnectionMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockTestConnectionMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'http://test.com:8123',
      }),
    );
  });
});
