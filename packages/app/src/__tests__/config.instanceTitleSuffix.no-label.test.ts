jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? undefined : 'unexpected',
}));

import { INSTANCE_TITLE_SUFFIX } from '@/config';

describe('INSTANCE_TITLE_SUFFIX (INSTANCE_LABEL unset)', () => {
  it('is empty', () => {
    expect(INSTANCE_TITLE_SUFFIX).toBe('');
  });
});
