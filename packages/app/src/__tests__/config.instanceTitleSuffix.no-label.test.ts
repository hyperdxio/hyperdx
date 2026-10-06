jest.mock('next-runtime-env', () => ({ env: () => undefined }));

import { INSTANCE_TITLE_SUFFIX } from '@/config';

describe('INSTANCE_TITLE_SUFFIX (INSTANCE_LABEL unset)', () => {
  it('is empty', () => {
    expect(INSTANCE_TITLE_SUFFIX).toBe('');
  });
});
