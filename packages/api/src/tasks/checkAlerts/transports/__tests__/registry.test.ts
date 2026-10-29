import { WebhookService } from '@hyperdx/common-utils/dist/types';

import { deliverToChannel } from '@/tasks/checkAlerts/transports';
import type { Message } from '@/tasks/checkAlerts/transports/types';

const message: Message = {
  hdxLink: 'https://example.test/alert',
  title: 'title',
  body: 'body',
  state: 'ALERT' as Message['state'],
  startTime: 0,
  endTime: 1,
  eventId: 'evt-1',
};

describe('deliverToChannel', () => {
  it('throws on an unknown channel type', async () => {
    await expect(
      deliverToChannel({ type: 'carrier-pigeon' } as never, message, {}),
    ).rejects.toThrow('Unsupported channel type: carrier-pigeon');
  });

  it('throws on an unknown webhook service', async () => {
    await expect(
      deliverToChannel(
        {
          type: 'webhook',
          channel: { service: 'fax' as WebhookService } as never,
        } as never,
        message,
        {},
      ),
    ).rejects.toThrow('Unsupported webhook service: fax');
  });
});
