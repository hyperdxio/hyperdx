import { getWebhookDetail } from '@/utils/webhooks';

describe('getWebhookDetail', () => {
  it('prefers the description', () => {
    expect(
      getWebhookDetail({
        description: 'Pages the on-call rotation',
        url: 'https://hooks.example.test/****',
      }),
    ).toBe('Pages the on-call rotation');
  });

  it('falls back to the URL when there is no description', () => {
    expect(getWebhookDetail({ url: 'https://hooks.example.test/****' })).toBe(
      'https://hooks.example.test/****',
    );
  });

  it('trims whitespace and treats a blank description as absent', () => {
    expect(
      getWebhookDetail({
        description: '   ',
        url: 'https://hooks.example.test/****',
      }),
    ).toBe('https://hooks.example.test/****');
    expect(getWebhookDetail({ description: '  Slack #alerts  ' })).toBe(
      'Slack #alerts',
    );
  });

  it('is undefined when neither description nor URL is set', () => {
    expect(getWebhookDetail({})).toBeUndefined();
    expect(getWebhookDetail({ description: '', url: '' })).toBeUndefined();
  });
});
