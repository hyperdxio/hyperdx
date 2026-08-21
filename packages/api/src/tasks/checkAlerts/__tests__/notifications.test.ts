import { InlineNotificationDispatcher } from '@/tasks/checkAlerts/notifications';

// The dispatcher forwards this opaque, so its shape doesn't matter for these
// tests — only that dispatch()/shutdown() behave per the documented contract.
const fakeJob: any = {};

describe('InlineNotificationDispatcher', () => {
  it('resolves after the deliver fn resolves', async () => {
    const order: string[] = [];
    const dispatcher = new InlineNotificationDispatcher(async () => {
      order.push('delivered');
    });
    await dispatcher.dispatch(fakeJob);
    order.push('dispatch-returned');
    expect(order).toEqual(['delivered', 'dispatch-returned']);
  });

  it('propagates a delivery rejection to the caller', async () => {
    const dispatcher = new InlineNotificationDispatcher(async () => {
      throw new Error('webhook exploded');
    });
    await expect(dispatcher.dispatch(fakeJob)).rejects.toThrow(
      'webhook exploded',
    );
  });

  it('shutdown resolves immediately — nothing is buffered', async () => {
    const dispatcher = new InlineNotificationDispatcher(async () => {});
    await expect(dispatcher.shutdown(1000)).resolves.toBeUndefined();
  });
});
