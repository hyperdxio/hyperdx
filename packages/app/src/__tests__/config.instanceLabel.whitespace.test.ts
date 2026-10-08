jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? 'EU   West' : undefined,
}));

import { INSTANCE_LABEL } from '@/config';

describe('INSTANCE_LABEL (internal whitespace run)', () => {
  it('collapses internal whitespace to a single space', () => {
    expect(INSTANCE_LABEL).toBe('EU West');
  });
});
