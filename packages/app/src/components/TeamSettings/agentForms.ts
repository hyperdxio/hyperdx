import { notifications } from '@mantine/notifications';

import { getApiErrorMessage } from '@/utils/apiErrors';

export const MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

export const notifyError = async (e: unknown) =>
  notifications.show({
    color: 'red',
    message: await getApiErrorMessage(e, 'Something went wrong'),
    // Long enough to read a teardown failure naming what to clean up.
    autoClose: 10000,
  });
