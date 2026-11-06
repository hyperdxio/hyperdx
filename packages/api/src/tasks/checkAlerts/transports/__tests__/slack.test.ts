import {
  formatSlackSectionText,
  getFallbackHdxLink,
  handleSendSlackWebhook,
} from '@/tasks/checkAlerts/transports/slack';
import type { Message, WebhookChannel } from '@/tasks/checkAlerts/transports/types';
import * as slack from '@/utils/slack';

jest.mock('@/utils/slack');
jest.mock('@/utils/validators');

describe('Slack transport', () => {
  describe('getFallbackHdxLink', () => {
    it('returns origin + /alerts for valid URLs', () => {
      expect(
        getFallbackHdxLink('https://app.hyperdx.io/chart?config=%7B%22very%22%3A%22long%22%7D'),
      ).toBe('https://app.hyperdx.io/alerts');
    });

    it('returns original input if not a valid URL', () => {
      expect(getFallbackHdxLink('not-a-url')).toBe('not-a-url');
    });
  });

  describe('formatSlackSectionText', () => {
    it('keeps standard link and body when under character limit', () => {
      const link = 'https://app.hyperdx.io/alerts/123';
      const title = 'High Error Rate';
      const body = 'Error rate exceeded 5%';
      expect(formatSlackSectionText(link, title, body)).toBe(
        `*<${link} | ${title}>*\n${body}`,
      );
    });

    it('falls back to /alerts when large query string exceeds limit', () => {
      const longQuery = 'x'.repeat(3100);
      const longLink = `https://app.hyperdx.io/chart?config=${longQuery}`;
      const title = 'High Latency';
      const body = 'p99 latency > 500ms';
      const formatted = formatSlackSectionText(longLink, title, body, 3000);

      expect(formatted).toBe(`*<https://app.hyperdx.io/alerts | ${title}>*\n${body}`);
      expect(formatted.length).toBeLessThanOrEqual(3000);
    });

    it('truncates body when text still exceeds limit after fallback link', () => {
      const longQuery = 'x'.repeat(2900);
      const longLink = `https://app.hyperdx.io/chart?config=${longQuery}`;
      const title = 'High Latency';
      const longBody = 'b'.repeat(3500);
      const formatted = formatSlackSectionText(longLink, title, longBody, 3000);

      expect(formatted.startsWith(`*<https://app.hyperdx.io/alerts | ${title}>*\n`)).toBe(true);
      expect(formatted.endsWith('...')).toBe(true);
      expect(formatted.length).toBeLessThanOrEqual(3000);
    });
  });

  describe('handleSendSlackWebhook', () => {
    it('passes formatted section block text to postMessageToWebhook', async () => {
      const mockPostMessage = jest.spyOn(slack, 'postMessageToWebhook').mockResolvedValue({} as any);

      const channel: WebhookChannel = {
        type: 'webhook',
        channel: {
          _id: 'wh-1' as any,
          name: 'Slack Alerts',
          service: 'slack' as any,
          url: 'https://hooks.slack.com/services/T00/B00/X00',
        } as any,
      };

      const message: Message = {
        hdxLink: 'https://app.hyperdx.io/chart?config=test',
        title: 'CPU Alert',
        body: 'CPU > 90%',
        state: 'ALERT' as any,
        startTime: 0,
        endTime: 1000,
        eventId: 'evt-1',
      };

      await handleSendSlackWebhook(channel, message);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T00/B00/X00',
        {
          text: 'CPU Alert',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*<https://app.hyperdx.io/chart?config=test | CPU Alert>*\nCPU > 90%',
              },
            },
          ],
        },
      );
    });
  });
});
