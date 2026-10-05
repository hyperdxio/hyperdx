jest.mock('next-runtime-env', () => ({ env: () => 'EU   West' }));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL (internal whitespace run)', () => {
  it('collapses internal whitespace to a single space', () => {
    expect(INSTANCE_LABEL).toBe('EU West');
  });
});
