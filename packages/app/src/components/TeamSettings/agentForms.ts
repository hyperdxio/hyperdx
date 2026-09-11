import { HTTPError } from 'ky';
import { notifications } from '@mantine/notifications';

export const MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

// ky's HTTPError message is only the status line; the API's own message says
// what actually went wrong (which Anthropic resources are still there, that no
// key is configured), which is the part the user can act on.
const errorMessage = async (e: unknown): Promise<string> => {
  if (e instanceof HTTPError) {
    const body: unknown = await e.response.json().catch(() => null);
    if (
      body != null &&
      typeof body === 'object' &&
      'message' in body &&
      typeof body.message === 'string' &&
      body.message.length > 0
    ) {
      return body.message;
    }
  }
  if (e instanceof Error && e.message) {
    return e.message;
  }
  return 'Something went wrong';
};

export const notifyError = async (e: unknown) =>
  notifications.show({
    color: 'red',
    message: await errorMessage(e),
    // Long enough to read a teardown failure naming what to clean up.
    autoClose: 10000,
  });
