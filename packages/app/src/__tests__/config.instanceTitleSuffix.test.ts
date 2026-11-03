jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? 'UK' : undefined,
}));

import { INSTANCE_TITLE_SUFFIX } from '@/config';

describe('INSTANCE_TITLE_SUFFIX', () => {
  it('is the label with a leading space, ready to append to a title', () => {
    expect(INSTANCE_TITLE_SUFFIX).toBe(' UK');
  });
});
