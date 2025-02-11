import { notifications } from '@mantine/notifications';
import { act, renderHook } from '@testing-library/react';

import api from '@/api';
import { useConnections } from '@/connection';

import { useConnectionHealth } from '../useConnectionHealth';

// Mock dependencies
jest.mock('@mantine/notifications');
jest.mock('@/api');
jest.mock('@/connection');

describe('useConnectionHealth', () => {
  const mockConnections = [
    {
      id: '1',
      name: 'Test Connection 1',
      host: 'localhost',
      username: 'user1',
      password: 'pass1',
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    (useConnections as jest.Mock).mockReturnValue({
      data: mockConnections,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('connection monitoring', () => {
    it('should start monitoring after initial delay', async () => {
      const testConnectionMock = jest.fn().mockResolvedValue({ success: true });
      (api.useTestConnection as jest.Mock).mockReturnValue({
        mutateAsync: testConnectionMock,
      });

      renderHook(() => useConnectionHealth());

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(testConnectionMock).toHaveBeenCalledWith({
        host: mockConnections[0].host,
        username: mockConnections[0].username,
        password: mockConnections[0].password,
      });
    });

    it('should show notification when connection fails', async () => {
      const testConnectionMock = jest.fn().mockResolvedValue({
        success: false,
        error: 'Connection failed',
      });
      (api.useTestConnection as jest.Mock).mockReturnValue({
        mutateAsync: testConnectionMock,
      });

      renderHook(() => useConnectionHealth());

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(notifications.show).toHaveBeenCalledWith({
        id: 'connection-error-1',
        color: 'red',
        message:
          'Connection "Test Connection 1" is not responding: Connection failed',
        autoClose: false,
      });
    });

    it('should respect retry delay for failed connections', async () => {
      const testConnectionMock = jest.fn().mockResolvedValue({
        success: false,
      });
      (api.useTestConnection as jest.Mock).mockReturnValue({
        mutateAsync: testConnectionMock,
      });

      renderHook(() => useConnectionHealth());

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(testConnectionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup', () => {
    it('should clean up intervals on unmount', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      const { unmount } = renderHook(() => useConnectionHealth());

      act(() => {
        unmount();
      });

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
